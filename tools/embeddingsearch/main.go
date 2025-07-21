package main

import (
	"archive/tar"
	"compress/gzip"
	"encoding/gob"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type EmbeddingEntry struct {
	Vector        []float64 `json:"Vector"`
	ReferenceText string    `json:"ReferenceText"`
	Text          string    `json:"Text"`
}

type EmbeddingDB struct {
	Table map[string]EmbeddingEntry `json:"Table"`
	// Inverted index for fast lookups
	invertedIndex map[string][]string // word -> list of keys containing that word
}

// Global flag to control output
var quietMode bool = false

// Global cache for loaded databases to avoid reloading
var (
	dbCache = make(map[string]*EmbeddingDB)
	cacheMutex sync.RWMutex
)

// CachedEmbeddingDB provides cached access to embedding databases
type CachedEmbeddingDB struct {
	path string
	db   *EmbeddingDB
}

// buildInvertedIndex creates an inverted index for fast word-based lookups
func (db *EmbeddingDB) buildInvertedIndex() {
	if db.invertedIndex != nil && len(db.invertedIndex) > 0 {
		// Already built
		return
	}
	
	db.invertedIndex = make(map[string][]string)
	
	for key, entry := range db.Table {
		// Index key tokens
		keyTokens := tokenize(key)
		for _, token := range keyTokens {
			db.invertedIndex[token] = append(db.invertedIndex[token], key)
		}
		
		// Index reference text tokens (limited to avoid memory bloat)
		refTokens := tokenize(entry.ReferenceText)
		for i, token := range refTokens {
			if i > 50 { // Limit to first 50 tokens
				break
			}
			db.invertedIndex[token] = append(db.invertedIndex[token], key)
		}
		
		// Also index Text field for better matching
		textTokens := tokenize(entry.Text)
		for i, token := range textTokens {
			if i > 30 { // Limit tokens from Text field
				break
			}
			db.invertedIndex[token] = append(db.invertedIndex[token], key)
		}
	}
	
	// Deduplicate entries
	for word, keys := range db.invertedIndex {
		seen := make(map[string]bool)
		unique := make([]string, 0, len(keys))
		for _, key := range keys {
			if !seen[key] {
				seen[key] = true
				unique = append(unique, key)
			}
		}
		db.invertedIndex[word] = unique
	}
}

// EQL query components
type EQLQuery struct {
	Table       string
	Fields      []string
	WhereClause string
	OrderBy     []OrderByClause
	Limit       int
	Delta       *DeltaClause
}

type OrderByClause struct {
	Field     string
	Direction string // ascending/descending
	Algorithm string // natural (optional)
}

type DeltaClause struct {
	Unit  string // milliseconds, seconds, etc.
	Value int
}

func (q *EQLQuery) String() string {
	query := q.Table
	
	if len(q.Fields) > 0 {
		query += fmt.Sprintf(" fields [%s]", strings.Join(q.Fields, ", "))
	}
	
	if q.WhereClause != "" {
		query += " where (" + q.WhereClause + ")"
	}
	
	if len(q.OrderBy) > 0 {
		orderParts := make([]string, 0, len(q.OrderBy))
		for _, ob := range q.OrderBy {
			part := ob.Field + " " + ob.Direction
			if ob.Algorithm != "" {
				part += " " + ob.Algorithm
			}
			orderParts = append(orderParts, part)
		}
		query += fmt.Sprintf(" order by [%s]", strings.Join(orderParts, ", "))
	}
	
	if q.Limit > 0 {
		query += fmt.Sprintf(" limit %d", q.Limit)
	}
	
	if q.Delta != nil {
		query += fmt.Sprintf(" delta %s %d", q.Delta.Unit, q.Delta.Value)
	}
	
	return query
}

// getBinaryCachePath returns the path for the binary cache file
func getBinaryCachePath(jsonPath string) string {
	dir := filepath.Dir(jsonPath)
	base := filepath.Base(jsonPath)
	return filepath.Join(dir, "."+base+".cache")
}

// saveBinaryCache saves the database to a binary cache file
func saveBinaryCache(db *EmbeddingDB, cachePath string) error {
	file, err := os.Create(cachePath)
	if err != nil {
		return err
	}
	defer file.Close()
	
	// No compression for faster loading
	enc := gob.NewEncoder(file)
	return enc.Encode(db)
}

// loadBinaryCache loads the database from a binary cache file
func loadBinaryCache(cachePath string) (*EmbeddingDB, error) {
	file, err := os.Open(cachePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	
	var db EmbeddingDB
	dec := gob.NewDecoder(file)
	if err := dec.Decode(&db); err != nil {
		return nil, err
	}
	
	return &db, nil
}

func loadDB(path string) (*EmbeddingDB, error) {
	// Check memory cache first
	cacheMutex.RLock()
	if cached, exists := dbCache[path]; exists {
		cacheMutex.RUnlock()
		if !quietMode {
			fmt.Printf("Using in-memory cached embeddings\n")
		}
		return cached, nil
	}
	cacheMutex.RUnlock()
	
	// Check binary cache
	cachePath := getBinaryCachePath(path)
	jsonInfo, _ := os.Stat(path)
	cacheInfo, cacheErr := os.Stat(cachePath)
	
	// Use binary cache if it exists and is newer than JSON
	if cacheErr == nil && jsonInfo != nil && cacheInfo.ModTime().After(jsonInfo.ModTime()) {
		if !quietMode {
			fmt.Printf("Loading from binary cache...\n")
		}
		start := time.Now()
		
		db, err := loadBinaryCache(cachePath)
		if err == nil {
			if !quietMode {
				fmt.Printf("Loaded binary cache in %.2f seconds\n", time.Since(start).Seconds())
			}
			
			// Cache in memory
			cacheMutex.Lock()
			dbCache[path] = db
			cacheMutex.Unlock()
			
			return db, nil
		}
		if !quietMode {
			fmt.Printf("Binary cache failed, falling back to JSON: %v\n", err)
		}
	}
	
	// Load from JSON file
	if !quietMode {
		fmt.Printf("Loading embeddings from %s...\n", filepath.Base(path))
	}
	start := time.Now()
	
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	
	var db EmbeddingDB
	dec := json.NewDecoder(file)
	if err := dec.Decode(&db); err != nil {
		return nil, err
	}
	
	jsonLoadTime := time.Since(start).Seconds()
	if !quietMode {
		fmt.Printf("JSON loaded in %.2f seconds\n", jsonLoadTime)
	}
	
	// Build inverted index
	if !quietMode {
		fmt.Println("Building search index...")
	}
	indexStart := time.Now()
	db.buildInvertedIndex()
	if !quietMode {
		fmt.Printf("Index built in %.2f seconds\n", time.Since(indexStart).Seconds())
	}
	
	// Save binary cache for next time
	if !quietMode {
		fmt.Println("Saving binary cache for faster future loads...")
	}
	cacheStart := time.Now()
	if err := saveBinaryCache(&db, cachePath); err != nil {
		if !quietMode {
			fmt.Printf("Warning: Failed to save binary cache: %v\n", err)
		}
	} else {
		if !quietMode {
			fmt.Printf("Binary cache saved in %.2f seconds\n", time.Since(cacheStart).Seconds())
		}
	}
	
	// Cache in memory
	cacheMutex.Lock()
	dbCache[path] = &db
	cacheMutex.Unlock()
	
	if !quietMode {
		fmt.Printf("Total load time: %.2f seconds\n", time.Since(start).Seconds())
		fmt.Printf("Loaded %d embeddings with %d indexed terms\n", len(db.Table), len(db.invertedIndex))
	}
	return &db, nil
}

func tokenize(s string) []string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, ".", " ")
	s = strings.ReplaceAll(s, "-", " ")
	s = strings.ReplaceAll(s, "_", " ")
	
	// Get all tokens
	tokens := strings.Fields(s)
	
	// Filter out common stop words for better natural language handling
	stopWords := map[string]bool{
		"the": true, "a": true, "an": true, "and": true, "or": true,
		"but": true, "in": true, "on": true, "at": true, "to": true,
		"for": true, "of": true, "with": true, "by": true, "from": true,
		"is": true, "are": true, "was": true, "were": true, "been": true,
		"have": true, "has": true, "had": true, "do": true, "does": true,
		"did": true, "will": true, "would": true, "could": true, "should": true,
		"may": true, "might": true, "must": true, "can": true, "what": true,
		"which": true, "who": true, "when": true, "where": true, "how": true,
		"why": true, "that": true, "this": true, "these": true, "those": true,
		"i": true, "me": true, "my": true, "mine": true, "we": true,
		"us": true, "our": true, "ours": true, "you": true, "your": true,
		"yours": true, "he": true, "him": true, "his": true, "she": true,
		"her": true, "hers": true, "it": true, "its": true, "they": true,
		"them": true, "their": true, "theirs": true,
	}
	
	// Only filter stop words if we have enough meaningful words
	meaningfulWords := 0
	for _, token := range tokens {
		if !stopWords[token] && len(token) > 1 {
			meaningfulWords++
		}
	}
	
	// If we have at least 2 meaningful words, filter stop words
	if meaningfulWords >= 2 {
		filtered := make([]string, 0, len(tokens))
		for _, token := range tokens {
			if !stopWords[token] || token == "all" || token == "show" || token == "get" || token == "list" {
				filtered = append(filtered, token)
			}
		}
		return filtered
	}
	
	return tokens
}

func expandSynonyms(words []string) []string {
	synonyms := map[string]string{
		"stats":       "statistics",
		"stat":        "statistics",
		"alarms":      "alarm",
		"alarm":       "alarms",
		"fanspeed":    "fan",
		"fan-speed":   "fan",
		"temp":        "temperature",
		"temps":       "temperature",
		"mtu":         "mtu",
		"interswitch": "link",
		"links":       "link",
		"iface":       "interface",
		"ifaces":      "interface",
		"intf":        "interface",
		"intfs":       "interface",
		"interfaces":  "interface", // Map plural to singular
		"neighbors":   "neighbor",
		"routes":      "route",
		"metrics":     "metric",
		"info":        "information",
		"config":      "configure",
		"configuration": "configure",
		// Common typos
		"inferface":   "interface",
		"inferfaces":  "interface",
		"interace":    "interface",
		"intrface":    "interface",
		"interfce":    "interface",
		"interfacs":   "interface",
		"interfaes":   "interface",
		"inerface":    "interface",
		"inerfaces":   "interface",
		"statitics":   "statistics",
		"statsitics":  "statistics",
		"statistcs":   "statistics",
		"statistis":   "statistics",
		"neighors":    "neighbor",
		"neigbors":    "neighbor",
		"neighbor":    "neighbor",
		"routers":     "router",
		"sysem":       "system",
		"systm":       "system",
		"bandwith":    "bandwidth",
		"bandwdth":    "bandwidth",
		"alrms":       "alarm",
		"alrm":        "alarm",
		"confg":       "configure",
		"cofig":       "configure",
		"usge":        "usage",
		"useage":      "usage",
		"dwn":         "down",
		"drps":        "drops",
		"drop":        "drops",
	}
	out := make([]string, 0, len(words))
	for _, w := range words {
		if s, ok := synonyms[w]; ok {
			out = append(out, s)
		} else {
			out = append(out, w)
		}
	}
	return out
}

func contains(tokens []string, word string) bool {
	for _, t := range tokens {
		if t == word {
			return true
		}
	}
	return false
}

// Parse the Text field to get available fields
func parseEmbeddingText(text string) []string {
	var data struct {
		Fields []string `json:"Fields"`
	}
	if err := json.Unmarshal([]byte(text), &data); err == nil {
		return data.Fields
	}
	return []string{}
}

// Extract fields from natural language
func extractFields(query string, tablePath string, embeddingEntry *EmbeddingEntry) []string {
	fields := []string{}
	lower := strings.ToLower(query)
	
	// Get available fields from embedding
	availableFields := parseEmbeddingText(embeddingEntry.Text)
	
	// Field keywords to field names mapping
	fieldKeywords := map[string][]string{
		"state":       {"admin-state", "oper-state", "state"},
		"status":      {"status", "oper-state", "admin-state"},
		"description": {"description"},
		"name":        {"name"},
		"memory":      {"memory", "memory-usage", "used"},
		"cpu":         {"cpu", "cpu-usage"},
		"traffic":     {"in-octets", "out-octets"},
		"bandwidth":   {"in-octets", "out-octets"},
		"packets":     {"in-packets", "out-packets"},
		"errors":      {"in-error-packets", "out-error-packets", "in-errors", "out-errors"},
		"severity":    {"severity"},
		"time":        {"time-created", "last-change", "last-clear"},
		"octets":      {"in-octets", "out-octets"},
		"mtu":         {"mtu", "ip-mtu", "oper-ip-mtu"},
		"drops":       {"in-drops", "out-drops", "in-discards", "out-discards"},
	}
	
	// Function to find matching available fields
	findMatchingFields := func(keywords []string) []string {
		var matches []string
		for _, keyword := range keywords {
			for _, available := range availableFields {
				if strings.Contains(strings.ToLower(available), keyword) {
					if !contains(matches, available) {
						matches = append(matches, available)
					}
				}
			}
		}
		return matches
	}
	
	// Check for specific field requests based on query keywords
	for keyword, possibleFields := range fieldKeywords {
		if strings.Contains(lower, keyword) {
			matches := findMatchingFields(possibleFields)
			for _, match := range matches {
				if !contains(fields, match) {
					fields = append(fields, match)
				}
			}
		}
	}
	
	// Special handling for interface errors when no statistics table
	if strings.Contains(lower, "error") && strings.Contains(tablePath, "interface") && !strings.Contains(tablePath, "statistics") {
		// Suggest looking at statistics if no direct error fields found
		if len(fields) == 0 {
			fields = append(fields, "statistics")
		}
	}
	
	return fields
}

// Extract node name from query
func extractNodeName(query string) string {
	words := strings.Fields(strings.ToLower(query))
	for i, w := range words {
		// Clean punctuation from word
		w = strings.TrimSuffix(w, "?")
		w = strings.TrimSuffix(w, "!")
		w = strings.TrimSuffix(w, ".")
		w = strings.TrimSuffix(w, ",")
		
		// Skip generic references
		if w == "nodes" || w == "node" || w == "my" {
			continue
		}
		
		// Check for specific node patterns
		if (strings.HasPrefix(w, "leaf") || strings.HasPrefix(w, "spine")) && len(w) > 4 {
			lastChar := w[len(w)-1]
			if lastChar >= '0' && lastChar <= '9' {
				return w
			}
		}
		
		// Check for "on <nodename>" or "for <nodename>" patterns
		if (w == "on" || w == "for" || w == "from") && i+1 < len(words) {
			next := strings.TrimSuffix(words[i+1], "?")
			next = strings.TrimSuffix(next, "!")
			next = strings.TrimSuffix(next, ".")
			next = strings.TrimSuffix(next, ",")
			// Skip common words and protocol names
			skipWords := map[string]bool{
				"nodes": true, "node": true, "my": true, "the": true,
				"bgp": true, "ospf": true, "isis": true, "mpls": true,
				"interface": true, "interfaces": true, "router": true,
				"system": true, "all": true, "any": true,
				"errors": true, "error": true, "drops": true, "drop": true,
				"statistics": true, "stats": true, "status": true,
				"configuration": true, "config": true, "state": true,
				"up": true, "down": true, "active": true, "inactive": true,
			}
			if !skipWords[next] && len(next) > 1 {
				return next
			}
		}
	}
	return ""
}

// Extract conditions for WHERE clause
func extractConditions(query string, tablePath string) map[string]string {
	conditions := make(map[string]string)
	lower := strings.ToLower(query)
	
	// State conditions for interfaces
	if strings.Contains(tablePath, "interface") {
		if strings.Contains(lower, "up") {
			conditions["oper-state"] = "up"
		} else if strings.Contains(lower, "down") {
			conditions["oper-state"] = "down"
		}
		
		if strings.Contains(lower, "enabled") {
			conditions["admin-state"] = "enable"
		} else if strings.Contains(lower, "disabled") {
			conditions["admin-state"] = "disable"
		}
	}
	
	// Alarm severity conditions
	if strings.Contains(tablePath, "alarm") {
		if strings.Contains(lower, "critical") {
			conditions["severity"] = "critical"
		} else if strings.Contains(lower, "major") {
			conditions["severity"] = "major"
		} else if strings.Contains(lower, "minor") {
			conditions["severity"] = "minor"
		}
		
		if strings.Contains(lower, "unacknowledged") || strings.Contains(lower, "not acknowledged") {
			conditions["acknowledged"] = "false"
		}
	}
	
	// Process conditions
	if strings.Contains(tablePath, "process") && strings.Contains(lower, "high memory") {
		conditions["memory-usage-threshold"] = "> 80"
	}
	
	// Extract numeric comparisons (e.g., "mtu greater than 1500")
	numericPattern := regexp.MustCompile(`(\w+)\s*(greater than|less than|equal to|!=|>=|<=|>|<|=)\s*(\d+)`)
	matches := numericPattern.FindAllStringSubmatch(lower, -1)
	for _, match := range matches {
		field := match[1]
		op := match[2]
		value := match[3]
		
		// Convert operator
		switch op {
		case "greater than":
			op = ">"
		case "less than":
			op = "<"
		case "equal to":
			op = "="
		}
		
		conditions[field] = op + " " + value
	}
	
	return conditions
}

// Generate WHERE clause
func generateWhereClause(tablePath string, query string) string {
	var whereParts []string
	
	// Extract node name
	nodeName := extractNodeName(query)
	if nodeName != "" && strings.Contains(tablePath, ".namespace.node.") {
		whereParts = append(whereParts, fmt.Sprintf(".namespace.node.name = \"%s\"", nodeName))
	}
	
	// Extract other conditions
	conditions := extractConditions(query, tablePath)
	for field, value := range conditions {
		if strings.HasPrefix(value, ">") || strings.HasPrefix(value, "<") || strings.HasPrefix(value, "=") {
			whereParts = append(whereParts, fmt.Sprintf("%s %s", field, value))
		} else {
			whereParts = append(whereParts, fmt.Sprintf("%s = \"%s\"", field, value))
		}
	}
	
	if len(whereParts) == 0 {
		return ""
	}
	
	return strings.Join(whereParts, " and ")
}

// Extract ORDER BY clauses
func extractOrderBy(query string, tablePath string, embeddingEntry *EmbeddingEntry) []OrderByClause {
	var orderBy []OrderByClause
	lower := strings.ToLower(query)
	
	// Get available fields from embedding
	availableFields := parseEmbeddingText(embeddingEntry.Text)
	
	// Function to find the best matching field for sorting
	findSortField := func(keywords []string) string {
		for _, keyword := range keywords {
			for _, field := range availableFields {
				if strings.Contains(strings.ToLower(field), keyword) {
					return field
				}
			}
		}
		return ""
	}
	
	// Common sorting patterns
	if strings.Contains(lower, "top") || strings.Contains(lower, "highest") || strings.Contains(lower, "most") {
		if strings.Contains(lower, "memory") {
			// Look for memory-related fields
			sortField := findSortField([]string{"memory-usage", "memory-utilization", "utilization", "used"})
			if sortField != "" {
				orderBy = append(orderBy, OrderByClause{sortField, "descending", ""})
			}
		} else if strings.Contains(lower, "cpu") {
			// Look for CPU-related fields
			sortField := findSortField([]string{"cpu-utilization", "cpu-usage", "cpu"})
			if sortField != "" {
				orderBy = append(orderBy, OrderByClause{sortField, "descending", ""})
			}
		} else if strings.Contains(lower, "traffic") {
			// Look for traffic-related fields
			sortField := findSortField([]string{"in-octets", "out-octets", "octets"})
			if sortField != "" {
				orderBy = append(orderBy, OrderByClause{sortField, "descending", ""})
			}
		}
	}
	
	if strings.Contains(lower, "lowest") || strings.Contains(lower, "least") {
		if strings.Contains(lower, "memory") {
			sortField := findSortField([]string{"memory-usage", "memory-utilization", "utilization", "used"})
			if sortField != "" {
				orderBy = append(orderBy, OrderByClause{sortField, "ascending", ""})
			}
		}
	}
	
	// Sort by time for alarms
	if strings.Contains(tablePath, "alarm") && (strings.Contains(lower, "recent") || strings.Contains(lower, "latest")) {
		sortField := findSortField([]string{"time-created", "last-change", "timestamp"})
		if sortField != "" {
			orderBy = append(orderBy, OrderByClause{sortField, "descending", ""})
		}
	}
	
	// Natural sorting for names
	if len(orderBy) == 0 && strings.Contains(lower, "sort") {
		sortField := findSortField([]string{"name"})
		if sortField != "" {
			orderBy = append(orderBy, OrderByClause{sortField, "ascending", "natural"})
		}
	}
	
	return orderBy
}

// Extract LIMIT value
func extractLimit(query string) int {
	lower := strings.ToLower(query)
	
	// Look for "top N" or "first N" patterns
	patterns := []string{
		`top (\d+)`,
		`first (\d+)`,
		`limit (\d+)`,
		`(\d+) results`,
	}
	
	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		if matches := re.FindStringSubmatch(lower); len(matches) > 1 {
			if limit, err := strconv.Atoi(matches[1]); err == nil && limit > 0 && limit <= 1000 {
				return limit
			}
		}
	}
	
	// Default limits for certain queries
	if strings.Contains(lower, "top") || strings.Contains(lower, "highest") {
		return 10
	}
	
	return 0
}

// Extract DELTA clause
func extractDelta(query string) *DeltaClause {
	lower := strings.ToLower(query)
	
	// Look for update frequency patterns
	patterns := map[string]*regexp.Regexp{
		"second": regexp.MustCompile(`every (\d+) seconds?`),
		"millisecond": regexp.MustCompile(`every (\d+) milliseconds?`),
		"realtime": regexp.MustCompile(`real[\s-]?time|streaming`),
	}
	
	for unit, pattern := range patterns {
		if matches := pattern.FindStringSubmatch(lower); len(matches) > 1 {
			if value, err := strconv.Atoi(matches[1]); err == nil && value > 0 {
				return &DeltaClause{
					Unit:  unit + "s",
					Value: value,
				}
			}
		}
	}
	
	// Real-time = 1 second updates
	if strings.Contains(lower, "real") && strings.Contains(lower, "time") {
		return &DeltaClause{
			Unit:  "seconds",
			Value: 1,
		}
	}
	
	return nil
}

type SearchResult struct {
	Key      string
	Score    float64
	EQLQuery EQLQuery
	Description string
	AvailableFields []string
}

// dotProduct calculates the dot product of two vectors
func dotProduct(a, b []float64) float64 {
	if len(a) != len(b) {
		return 0
	}
	sum := 0.0
	for i := range a {
		sum += a[i] * b[i]
	}
	return sum
}

// magnitude calculates the magnitude of a vector
func magnitude(v []float64) float64 {
	sum := 0.0
	for _, val := range v {
		sum += val * val
	}
	return math.Sqrt(sum)
}

// cosineSimilarity calculates the cosine similarity between two vectors
func cosineSimilarity(a, b []float64) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	
	dot := dotProduct(a, b)
	magA := magnitude(a)
	magB := magnitude(b)
	
	if magA == 0 || magB == 0 {
		return 0
	}
	
	return dot / (magA * magB)
}

// createQueryEmbedding creates a simple embedding from query words using TF-IDF-like approach
func createQueryEmbedding(query string, vocabSize int) []float64 {
	// Create a random but deterministic embedding based on query
	// This is a simplified approach - in production you'd use a proper embedding model
	embedding := make([]float64, vocabSize)
	words := expandSynonyms(tokenize(query))
	
	// Use a deterministic random approach based on word content
	for _, word := range words {
		// Create a seed from the word
		seed := int64(0)
		for _, ch := range word {
			seed = seed*31 + int64(ch)
		}
		
		// Generate pseudo-random values
		for j := 0; j < vocabSize; j++ {
			// Simple linear congruential generator
			seed = (seed*1103515245 + 12345) & 0x7fffffff
			value := float64(seed) / float64(0x7fffffff)
			
			// Create sparse embedding with some randomness
			if value < 0.1 { // 10% chance of non-zero
				embedding[j] += (value - 0.05) * 2.0 / float64(len(words))
			}
		}
	}
	
	// Add some Gaussian-like smoothing
	smoothed := make([]float64, vocabSize)
	for i := range embedding {
		sum := embedding[i] * 0.5
		if i > 0 {
			sum += embedding[i-1] * 0.25
		}
		if i < vocabSize-1 {
			sum += embedding[i+1] * 0.25
		}
		smoothed[i] = sum
	}
	
	// Normalize to unit vector
	mag := magnitude(smoothed)
	if mag > 0 {
		for i := range smoothed {
			smoothed[i] /= mag
		}
	}
	
	return smoothed
}

// vectorSearch performs fast indexed search with pre-filtering
func (db *EmbeddingDB) vectorSearch(query string) []SearchResult {
	words := expandSynonyms(tokenize(query))
	
	// Detect if this is an SROS database by checking a few entries
	isSROSDB := false
	for key := range db.Table {
		if strings.Contains(key, ".sros.") {
			isSROSDB = true
			break
		}
	}
	
	// Use inverted index to get candidate keys
	candidateKeys := make(map[string]int)
	for _, word := range words {
		if keys, exists := db.invertedIndex[word]; exists {
			for _, key := range keys {
				candidateKeys[key]++
			}
		}
	}
	
	// For SROS database or queries, ensure we get interface-related entries
	if isSROSDB || detectEmbeddingType(query) == SROS {
		// Add all entries containing "interface" if that's in the query
		for _, word := range words {
			if word == "interface" || word == "interfaces" {
				// Also check for variations
				for indexWord, keys := range db.invertedIndex {
					if strings.Contains(indexWord, "interface") {
						for _, key := range keys {
							candidateKeys[key]++
						}
					}
				}
			}
		}
	}
	
	// If no candidates from index, fall back to full search
	if len(candidateKeys) == 0 {
		return db.search(query)
	}
	
	// Score only the candidates
	results := make([]SearchResult, 0)
	bigrams := make([]string, 0, len(words)-1)
	for i := 0; i < len(words)-1; i++ {
		bigrams = append(bigrams, words[i]+" "+words[i+1])
	}
	
	// Process candidates with scoring
	type scoredCandidate struct {
		key   string
		score float64
	}
	
	candidates := make([]scoredCandidate, 0, len(candidateKeys))
	
	for key, matchCount := range candidateKeys {
		entry := db.Table[key]
		
		// Base score from inverted index matches
		baseScore := float64(matchCount) * 10
		
		// Bonus for having all query words in the key
		allWordsInKey := true
		for _, word := range words {
			if !strings.Contains(strings.ToLower(key), word) {
				allWordsInKey = false
				break
			}
		}
		if allWordsInKey {
			baseScore += float64(len(words)) * 20 // Big bonus for complete matches
		}
		
		// Additional scoring
		additionalScore := db.scoreEntry(key, entry, query, words, bigrams)
		
		totalScore := baseScore + additionalScore
		
		// Adjust threshold based on platform
		threshold := 10.0
		if strings.Contains(key, ".sros.") {
			threshold = 8.0 // Lower threshold for SROS to get better results
		}
		
		if totalScore > threshold {
			candidates = append(candidates, scoredCandidate{
				key:   key,
				score: totalScore,
			})
		}
	}
	
	// Sort candidates
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].score > candidates[j].score
	})
	
	// Generate EQL for top 10
	for i, cand := range candidates {
		if i >= 10 {
			break
		}
		
		entry := db.Table[cand.key]
		eql := EQLQuery{
			Table:       cand.key,
			Fields:      extractFields(query, cand.key, &entry),
			WhereClause: generateWhereClause(cand.key, query),
			OrderBy:     extractOrderBy(query, cand.key, &entry),
			Limit:       extractLimit(query),
			Delta:       extractDelta(query),
		}
		results = append(results, SearchResult{
			Key:      cand.key,
			Score:    cand.score,
			EQLQuery: eql,
		})
	}
	
	return results
}

func (db *EmbeddingDB) search(query string) []SearchResult {
	words := expandSynonyms(tokenize(query))
	bigrams := make([]string, 0, len(words)-1)
	for i := 0; i < len(words)-1; i++ {
		bigrams = append(bigrams, words[i]+" "+words[i+1])
	}
	
	results := make([]SearchResult, 0)
	
	// Check for alarm queries first (not in embeddings)
	alarmScore := 0.0
	for _, w := range words {
		if w == "alarm" || w == "alarms" {
			alarmScore += 10
		}
		if w == "critical" || w == "major" || w == "minor" {
			alarmScore += 5
		}
	}
	if alarmScore > 0 {
		alarmPath := ".namespace.alarms.v1.alarm"
		// Create a dummy embedding entry for alarms (not in actual embeddings)
		alarmEntry := &EmbeddingEntry{
			Text: `{"Description":"Active alarms in the system","Fields":["severity","text","time-created","acknowledged"]}`,
		}
		eql := EQLQuery{
			Table:       alarmPath,
			Fields:      extractFields(query, alarmPath, alarmEntry),
			WhereClause: generateWhereClause(alarmPath, query),
			OrderBy:     extractOrderBy(query, alarmPath, alarmEntry),
			Limit:       extractLimit(query),
			Delta:       extractDelta(query),
		}
		results = append(results, SearchResult{
			Key:      alarmPath,
			Score:    alarmScore,
			EQLQuery: eql,
			Description: "Active alarms in the system",
			AvailableFields: []string{"severity", "text", "time-created", "acknowledged"},
		})
	}
	
	// Aggressive optimization for top-10 results only
	const maxWorkers = 4
	const chunkSize = 2000  // Larger chunks for better throughput
	const scoreThreshold = 5.0  // Higher threshold for faster filtering
	const maxCandidates = 20   // Only keep top 20 candidates during processing
	
	keys := make([]string, 0, len(db.Table))
	for key := range db.Table {
		keys = append(keys, key)
	}
	
	// Use a simpler structure for intermediate results - just score and key
	type candidate struct {
		key   string
		score float64
	}
	
	candidateChan := make(chan candidate, 50)
	var wg sync.WaitGroup
	
	// Process in chunks with early termination
	for i := 0; i < len(keys); i += chunkSize {
		end := i + chunkSize
		if end > len(keys) {
			end = len(keys)
		}
		
		wg.Add(1)
		go func(start, end int) {
			defer wg.Done()
			
			for j := start; j < end; j++ {
				key := keys[j]
				entry := db.Table[key]
				
				score := db.scoreEntry(key, entry, query, words, bigrams)
				
				// Only process high-scoring entries
				if score > scoreThreshold {
					candidateChan <- candidate{key: key, score: score}
				}
			}
		}(i, end)
	}
	
	// Close channel when all workers are done
	go func() {
		wg.Wait()
		close(candidateChan)
	}()
	
	// Collect only the best candidates - maintain sorted list of top candidates
	candidates := make([]candidate, 0, maxCandidates)
	minScore := scoreThreshold
	
	for cand := range candidateChan {
		if len(candidates) < maxCandidates {
			candidates = append(candidates, cand)
			if len(candidates) == maxCandidates {
				// Sort and find minimum score
				sort.Slice(candidates, func(i, j int) bool {
					return candidates[i].score > candidates[j].score
				})
				minScore = candidates[maxCandidates-1].score
			}
		} else if cand.score > minScore {
			// Replace worst candidate
			candidates[maxCandidates-1] = cand
			// Re-sort to maintain order
			sort.Slice(candidates, func(i, j int) bool {
				return candidates[i].score > candidates[j].score
			})
			minScore = candidates[maxCandidates-1].score
		}
	}
	
	// Now generate EQL only for the top candidates
	for _, cand := range candidates {
		if len(results) >= 10 { // Only need 10 results maximum
			break
		}
		
		entry := db.Table[cand.key]
		
		// Parse description and fields from entry
		var embeddingInfo struct {
			Description string   `json:"Description"`
			Fields      []string `json:"Fields"`
		}
		description := ""
		availableFields := []string{}
		if err := json.Unmarshal([]byte(entry.Text), &embeddingInfo); err == nil {
			description = embeddingInfo.Description
			availableFields = embeddingInfo.Fields
		}
		
		eql := EQLQuery{
			Table:       cand.key,
			Fields:      extractFields(query, cand.key, &entry),
			WhereClause: generateWhereClause(cand.key, query),
			OrderBy:     extractOrderBy(query, cand.key, &entry),
			Limit:       extractLimit(query),
			Delta:       extractDelta(query),
		}
		results = append(results, SearchResult{
			Key:      cand.key,
			Score:    cand.score,
			EQLQuery: eql,
			Description: description,
			AvailableFields: availableFields,
		})
	}
	
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})
	
	// Limit to maximum 10 results for better performance
	if len(results) > 10 {
		results = results[:10]
	}
	
	return results
}

// scoreEntry calculates the score for a single embedding entry
func (db *EmbeddingDB) scoreEntry(key string, entry EmbeddingEntry, query string, words []string, bigrams []string) float64 {
	keyTokens := tokenize(key)
	textTokens := tokenize(entry.ReferenceText + " " + entry.Text)
	score := 0.0
	queryLower := strings.ToLower(query)
	
	// Parse description from Text field if available
	var embeddingInfo struct {
		Description string   `json:"Description"`
		Fields      []string `json:"Fields"`
	}
	if err := json.Unmarshal([]byte(entry.Text), &embeddingInfo); err == nil {
		// Check if description contains query words
		descTokens := tokenize(embeddingInfo.Description)
		descLower := strings.ToLower(embeddingInfo.Description)
		
		// Count matching words in description
		descMatchCount := 0
		for _, w := range words {
			if contains(descTokens, w) {
				descMatchCount++
				score += 3 // Increased from 2
			}
		}
		
		// Bonus for natural language phrases in description
		if strings.Contains(queryLower, "list of") && strings.Contains(descLower, "list of") {
			score += 5
		}
		if strings.Contains(queryLower, "all") && strings.Contains(descLower, "all") {
			score += 3
		}
		if strings.Contains(queryLower, "show") && strings.Contains(descLower, "display") {
			score += 2
		}
		if strings.Contains(queryLower, "get") && strings.Contains(descLower, "retrieve") {
			score += 2
		}
		
		// If multiple query words appear in description, give extra bonus
		if descMatchCount >= 2 && descMatchCount >= len(words)/2 {
			score += 5
		}
	}
	
	// Check for exact last segment match (high priority)
	if len(keyTokens) > 0 && len(words) > 0 {
		lastSegment := keyTokens[len(keyTokens)-1]
		for _, w := range words {
			if lastSegment == w {
				score += 10 // Reduced from 20
			}
		}
	}
	
	// Count exact word matches in path
	pathMatchCount := 0
	for _, w := range words {
		if contains(keyTokens, w) {
			pathMatchCount++
			// Give scores for important keywords (reduced values)
			if w == "interface" || w == "interfaces" {
				score += 8
			} else if w == "statistics" {
				score += 6
			} else if w == "state" || w == "configure" {
				score += 4
			} else {
				score += 3
			}
		} else if contains(textTokens, w) {
			score += 1
		}
	}
	
	// Bonus for paths that contain ALL query words (reduced)
	if pathMatchCount == len(words) && len(words) > 1 {
		score += float64(len(words)) * 3
	}
	
	// Prefer state paths for "show" commands
	if strings.Contains(queryLower, "show") && strings.Contains(key, ".state.") {
		score += 5
	}
	
	// Path hierarchy scoring - prefer direct matches over nested ones
	keyLower := strings.ToLower(key)
	
	// Special handling for interface queries - penalize security/violator paths
	if strings.Contains(queryLower, "interface") {
		if strings.Contains(keyLower, "violator") || strings.Contains(keyLower, "security") {
			score -= 20 // Reduced penalty
		}
		
		// Prefer paths that end with the main query term
		if strings.HasSuffix(key, ".interface") && !strings.Contains(key, ".protocols.") {
			score += 20 // Bonus for paths ending in interface (not protocol-specific)
		}
		
		// Prefer direct statistics paths
		if strings.Contains(queryLower, "statistics") && strings.HasSuffix(key, ".interface.statistics") {
			score += 15
		}
		
		// Penalize protocol-specific interface paths for general interface queries
		if !strings.Contains(queryLower, "bgp") && !strings.Contains(queryLower, "ospf") && !strings.Contains(queryLower, "isis") {
			if strings.Contains(keyLower, "protocols.bgp") || strings.Contains(keyLower, "protocols.ospf") || strings.Contains(keyLower, "protocols.isis") {
				score -= 15
			}
		}
		
		// For "interfaces" plural query, prefer the main interface table
		if strings.Contains(queryLower, "interfaces") && strings.HasSuffix(key, ".interface") {
			score += 10
		}
	}
	
	// Special handling for BGP queries
	if strings.Contains(queryLower, "bgp") && strings.Contains(queryLower, "neighbor") {
		// Prefer paths that have bgp and end with neighbor
		if strings.Contains(key, "bgp") && strings.HasSuffix(key, ".neighbor") {
			score += 15
		}
		// Penalize maintenance paths
		if strings.Contains(key, "maintenance") {
			score -= 10
		}
	}
	
	// Count the segments after the main keyword match
	for _, word := range words {
		if idx := strings.Index(keyLower, word); idx != -1 {
			// Count dots after the match
			afterMatch := keyLower[idx+len(word):]
			dotCount := strings.Count(afterMatch, ".")
			// Fewer dots = more direct match = higher score
			if dotCount == 0 {
				score += 10 // Perfect end match
			} else if dotCount <= 2 {
				score += 6
			} else if dotCount <= 4 {
				score += 2
			}
		}
	}
	
	// Special handling for subinterface queries
	if strings.Contains(query, "subinterface") && strings.Contains(key, "subinterface") {
		if strings.HasSuffix(key, ".subinterface") {
			score += 10 // Reduced
		} else {
			score += 2
		}
	}
	
	// Boost for exact table matches (last segment matches query word)
	for _, w := range words {
		if strings.HasSuffix(key, "."+w) {
			score += 6
		}
	}
	
	// Bigram matching
	for _, b := range bigrams {
		if strings.Contains(keyLower, strings.ReplaceAll(b, " ", ".")) {
			score += 2
		}
	}
	
	// Boost score for tables that can extract the requested fields
	extractedFields := extractFields(query, key, &entry)
	if len(extractedFields) > 0 {
		score += float64(len(extractedFields)) * 1.5 // Reduced
	}
	
	// Prefer paths that have query words in sequence
	if strings.Contains(query, "interface") && strings.Contains(query, "statistics") {
		if strings.Contains(key, "interface") && strings.Contains(key, "statistics") {
			// Check if statistics comes right after interface
			if strings.Contains(key, "interface.statistics") {
				score += 8
			} else {
				score += 4
			}
		}
	}
	
	// Strongly prefer shorter, more direct paths
	pathDepth := len(keyTokens)
	if pathDepth > 0 {
		// Count meaningful segments (excluding namespace, node, nodename)
		meaningfulDepth := 0
		for i, token := range keyTokens {
			if i > 2 && token != "state" && token != "configure" {
				meaningfulDepth++
			}
		}
		
		// Strong preference for direct paths
		if meaningfulDepth <= 2 {
			score += 20 // Big bonus for very direct paths
		} else if meaningfulDepth <= 3 {
			score += 10
		} else if meaningfulDepth <= 4 {
			score += 5
		} else {
			// Penalize deeply nested paths
			score -= float64(meaningfulDepth-4) * 2
		}
	}
	
	// Additional penalty for overly specific paths when query is general
	if strings.Contains(key, "protocols") && !strings.Contains(queryLower, "protocol") &&
	   !strings.Contains(queryLower, "bgp") && !strings.Contains(queryLower, "ospf") &&
	   !strings.Contains(queryLower, "isis") {
		score -= 10 // Penalize protocol-specific paths for general queries
	}
	
	// Penalize maintenance/group paths unless specifically requested
	if strings.Contains(key, "maintenance") && !strings.Contains(queryLower, "maintenance") {
		score -= 8
	}
	
	// For error queries, prefer paths with error fields
	if strings.Contains(queryLower, "error") {
		if strings.Contains(key, "statistics") && len(extractedFields) > 0 {
			// Check if we found error-related fields
			for _, field := range extractedFields {
				if strings.Contains(field, "error") {
					score += 10
					break
				}
			}
		}
	}
	
	// For bandwidth queries, prefer interface paths with traffic fields
	if strings.Contains(queryLower, "bandwidth") && strings.Contains(key, "interface") {
		if len(extractedFields) > 0 {
			for _, field := range extractedFields {
				if strings.Contains(field, "octets") || strings.Contains(field, "bandwidth") {
					score += 10
					break
				}
			}
		}
	}
	
	return score
}

// getEmbeddingsPath returns the path to the embeddings directory
func getEmbeddingsPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "~/.eda/vscode/embeddings"
	}
	return filepath.Join(homeDir, ".eda", "vscode", "embeddings")
}

// EmbeddingType represents the type of embeddings to use
type EmbeddingType int

const (
	SRL EmbeddingType = iota
	SROS
)

// detectEmbeddingType determines which embedding set to use based on query content
func detectEmbeddingType(query string) EmbeddingType {
	queryLower := strings.ToLower(query)
	
	// Check for SROS-specific keywords
	srosKeywords := []string{"sros", "sr os", "service router", "7750", "7450", "7250", "7950"}
	for _, keyword := range srosKeywords {
		if strings.Contains(queryLower, keyword) {
			return SROS
		}
	}
	
	// Default to SRL
	return SRL
}

// getEmbeddingPaths returns the paths for both SRL and SROS embeddings
func getEmbeddingPaths() (string, string) {
	embeddingsDir := getEmbeddingsPath()
	srlPath := filepath.Join(embeddingsDir, "ce-llm-embed-db-srl-25.3.3.json")
	srosPath := filepath.Join(embeddingsDir, "ce-llm-embed-db-sros-25.3.r1.json")
	return srlPath, srosPath
}

// downloadEmbeddings downloads and extracts a specific embedding set
func downloadEmbeddings(embType EmbeddingType, embeddingsDir string) error {
	var url, expectedFile string
	
	switch embType {
	case SRL:
		url = "https://github.com/nokia-eda/llm-embeddings/releases/download/nokia-srl-25.3.3/llm-embeddings-srl-25-3-3.tar.gz"
		expectedFile = "ce-llm-embed-db-srl-25.3.3.json"
		if !quietMode {
			fmt.Println("Downloading SRL embeddings from GitHub...")
		}
	case SROS:
		url = "https://github.com/nokia-eda/llm-embeddings/releases/download/nokia-sros-v25.3.r2/llm-embeddings-sros-25-3-r2.tar.gz"
		expectedFile = "ce-llm-embed-db-sros-25.3.r1.json"
		if !quietMode {
			fmt.Println("Downloading SROS embeddings from GitHub...")
		}
	}
	
	// Download the tar.gz file
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to download embeddings: %v", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download embeddings: HTTP %d", resp.StatusCode)
	}
	
	if !quietMode {
		fmt.Println("Extracting embeddings...")
	}
	
	// Create gzip reader
	gzipReader, err := gzip.NewReader(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to create gzip reader: %v", err)
	}
	defer gzipReader.Close()
	
	// Create tar reader
	tarReader := tar.NewReader(gzipReader)
	
	// Extract files
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar entry: %v", err)
		}
		
		// Skip directories
		if header.Typeflag == tar.TypeDir {
			continue
		}
		
		// Create the file path
		filePath := filepath.Join(embeddingsDir, header.Name)
		
		// Create directory if needed
		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			return fmt.Errorf("failed to create directory: %v", err)
		}
		
		// Create the file
		file, err := os.Create(filePath)
		if err != nil {
			return fmt.Errorf("failed to create file %s: %v", filePath, err)
		}
		
		// Copy file contents
		if _, err := io.Copy(file, tarReader); err != nil {
			file.Close()
			return fmt.Errorf("failed to write file %s: %v", filePath, err)
		}
		file.Close()
	}
	
	if !quietMode {
		fmt.Println("Embeddings extracted successfully!")
	}
	
	// Verify the expected file exists
	expectedPath := filepath.Join(embeddingsDir, expectedFile)
	if _, err := os.Stat(expectedPath); err != nil {
		return fmt.Errorf("expected embedding file not found after extraction: %s", expectedPath)
	}
	
	return nil
}

// downloadAndExtractEmbeddings downloads and extracts the embedding files if they don't exist
func downloadAndExtractEmbeddings(query string) (string, error) {
	embeddingsDir := getEmbeddingsPath()
	srlPath, srosPath := getEmbeddingPaths()
	
	// Create embeddings directory
	if err := os.MkdirAll(embeddingsDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create embeddings directory: %v", err)
	}
	
	// Determine which embedding type to use
	embType := detectEmbeddingType(query)
	
	var targetPath string
	switch embType {
	case SRL:
		targetPath = srlPath
		// Check if SRL embeddings exist, download if not
		if _, err := os.Stat(srlPath); err != nil {
			if err := downloadEmbeddings(SRL, embeddingsDir); err != nil {
				return "", err
			}
		}
	case SROS:
		targetPath = srosPath
		// Check if SROS embeddings exist, download if not
		if _, err := os.Stat(srosPath); err != nil {
			if err := downloadEmbeddings(SROS, embeddingsDir); err != nil {
				return "", err
			}
		}
	}
	
	return targetPath, nil
}

func main() {
	dbPath := flag.String("db", "", "path to embedding db (auto-downloads if not specified)")
	verbose := flag.Bool("v", false, "verbose output showing all query components")
	jsonOutput := flag.Bool("json", false, "output results as JSON")
	flag.Parse()
	
	if flag.NArg() == 0 {
		fmt.Println("usage: embeddingsearch [-v] [-json] <query>")
		fmt.Println("\nExamples:")
		fmt.Println("  embeddingsearch 'show interface statistics for leaf1'")
		fmt.Println("  embeddingsearch 'get top 5 processes by memory usage'")
		fmt.Println("  embeddingsearch 'critical alarms from the last hour'")
		fmt.Println("  embeddingsearch 'interface traffic on spine1 every 5 seconds'")
		fmt.Println("  embeddingsearch -json 'show interfaces'  # Output as JSON")
		return
	}
	
	query := strings.Join(flag.Args(), " ")
	
	// Set quiet mode for JSON output
	quietMode = *jsonOutput
	
	// Determine the database path
	var finalDBPath string
	if *dbPath != "" {
		finalDBPath = *dbPath
	} else {
		// Auto-download embeddings if not specified (based on query content)
		var err error
		finalDBPath, err = downloadAndExtractEmbeddings(query)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to download embeddings: %v\n", err)
			os.Exit(1)
		}
	}
	db, err := loadDB(finalDBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load db: %v\n", err)
		os.Exit(1)
	}
	
	// Use vector search for better performance
	results := db.vectorSearch(query)
	if len(results) == 0 {
		if *jsonOutput {
			fmt.Println(`{"error": "No matches found", "results": []}`)
		} else {
			fmt.Println("No matches found")
		}
		return
	}
	
	if *jsonOutput {
		// Output as JSON
		type JSONResult struct {
			Score    float64  `json:"score"`
			Query    string   `json:"query"`
			Table    string   `json:"table"`
			Description string `json:"description,omitempty"`
			AvailableFields []string `json:"availableFields,omitempty"`
			Fields   []string `json:"fields,omitempty"`
			Where    string   `json:"where,omitempty"`
			OrderBy  []struct {
				Field     string `json:"field"`
				Direction string `json:"direction"`
				Algorithm string `json:"algorithm,omitempty"`
			} `json:"orderBy,omitempty"`
			Limit int `json:"limit,omitempty"`
			Delta *struct {
				Unit  string `json:"unit"`
				Value int    `json:"value"`
			} `json:"delta,omitempty"`
		}
		
		type JSONOutput struct {
			TopMatch JSONResult   `json:"topMatch"`
			Others   []JSONResult `json:"others,omitempty"`
		}
		
		// Convert top match
		top := results[0]
		topMatch := JSONResult{
			Score:  top.Score,
			Query:  top.EQLQuery.String(),
			Table:  top.EQLQuery.Table,
			Description: top.Description,
			AvailableFields: top.AvailableFields,
			Fields: top.EQLQuery.Fields,
			Where:  top.EQLQuery.WhereClause,
			Limit:  top.EQLQuery.Limit,
		}
		
		if len(top.EQLQuery.OrderBy) > 0 {
			for _, ob := range top.EQLQuery.OrderBy {
				topMatch.OrderBy = append(topMatch.OrderBy, struct {
					Field     string `json:"field"`
					Direction string `json:"direction"`
					Algorithm string `json:"algorithm,omitempty"`
				}{
					Field:     ob.Field,
					Direction: ob.Direction,
					Algorithm: ob.Algorithm,
				})
			}
		}
		
		if top.EQLQuery.Delta != nil {
			topMatch.Delta = &struct {
				Unit  string `json:"unit"`
				Value int    `json:"value"`
			}{
				Unit:  top.EQLQuery.Delta.Unit,
				Value: top.EQLQuery.Delta.Value,
			}
		}
		
		output := JSONOutput{TopMatch: topMatch}
		
		// Add other matches
		maxOthers := 9
		if len(results)-1 < maxOthers {
			maxOthers = len(results) - 1
		}
		for i := 1; i <= maxOthers; i++ {
			r := results[i]
			other := JSONResult{
				Score:  r.Score,
				Query:  r.EQLQuery.String(),
				Table:  r.EQLQuery.Table,
				Description: r.Description,
				AvailableFields: r.AvailableFields,
				Fields: r.EQLQuery.Fields,
				Where:  r.EQLQuery.WhereClause,
				Limit:  r.EQLQuery.Limit,
			}
			
			if len(r.EQLQuery.OrderBy) > 0 {
				for _, ob := range r.EQLQuery.OrderBy {
					other.OrderBy = append(other.OrderBy, struct {
						Field     string `json:"field"`
						Direction string `json:"direction"`
						Algorithm string `json:"algorithm,omitempty"`
					}{
						Field:     ob.Field,
						Direction: ob.Direction,
						Algorithm: ob.Algorithm,
					})
				}
			}
			
			if r.EQLQuery.Delta != nil {
				other.Delta = &struct {
					Unit  string `json:"unit"`
					Value int    `json:"value"`
				}{
					Unit:  r.EQLQuery.Delta.Unit,
					Value: r.EQLQuery.Delta.Value,
				}
			}
			
			output.Others = append(output.Others, other)
		}
		
		jsonData, err := json.MarshalIndent(output, "", "  ")
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to marshal JSON: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(string(jsonData))
		return
	}
	
	// Display top match
	top := results[0]
	fmt.Printf("Top match (score: %.2f):\n%s\n", top.Score, top.EQLQuery.String())
	
	if *verbose {
		fmt.Println("\nQuery components:")
		fmt.Printf("  Table: %s\n", top.EQLQuery.Table)
		if len(top.EQLQuery.Fields) > 0 {
			fmt.Printf("  Fields: %s\n", strings.Join(top.EQLQuery.Fields, ", "))
		}
		if top.EQLQuery.WhereClause != "" {
			fmt.Printf("  Where: %s\n", top.EQLQuery.WhereClause)
		}
		if len(top.EQLQuery.OrderBy) > 0 {
			fmt.Print("  Order by: ")
			for i, ob := range top.EQLQuery.OrderBy {
				if i > 0 {
					fmt.Print(", ")
				}
				fmt.Printf("%s %s", ob.Field, ob.Direction)
				if ob.Algorithm != "" {
					fmt.Printf(" %s", ob.Algorithm)
				}
			}
			fmt.Println()
		}
		if top.EQLQuery.Limit > 0 {
			fmt.Printf("  Limit: %d\n", top.EQLQuery.Limit)
		}
		if top.EQLQuery.Delta != nil {
			fmt.Printf("  Delta: %s %d\n", top.EQLQuery.Delta.Unit, top.EQLQuery.Delta.Value)
		}
	}
	
	// Show other matches (limit to 9 more for total of 10)
	if len(results) > 1 {
		fmt.Println("\nOther possible matches:")
		maxOthers := 9
		if len(results)-1 < maxOthers {
			maxOthers = len(results) - 1
		}
		for i := 1; i <= maxOthers; i++ {
			fmt.Printf("%d. %s (score: %.2f)\n", i, results[i].EQLQuery.String(), results[i].Score)
		}
	}
}