import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface EmbeddingSearchResult {
  topMatch: {
    score: number;
    query: string;
    table: string;
    fields?: string[];
    where?: string;
    orderBy?: Array<{
      field: string;
      direction: string;
      algorithm?: string;
    }>;
    limit?: number;
    delta?: {
      unit: string;
      value: number;
    };
  };
  others?: Array<{
    score: number;
    query: string;
    table: string;
  }>;
}

export class EmbeddingSearchService {
  private binaryPath: string;
  private extensionPath: string;

  constructor(context: vscode.ExtensionContext) {
    this.extensionPath = context.extensionPath;

    // Determine binary name based on platform
    const platform = process.platform;
    const arch = process.arch;
    let binaryName = 'embeddingsearch';

    if (platform === 'win32') {
      binaryName = 'embeddingsearch.exe';
    } else if (platform === 'darwin' && arch === 'arm64') {
      binaryName = 'embeddingsearch-arm64';
    }

    // Binary should be in the bundled binaries directory
    this.binaryPath = path.join(this.extensionPath, 'bin', platform, binaryName);

    // For development, fall back to the tools directory
    if (!fs.existsSync(this.binaryPath)) {
      this.binaryPath = path.join(this.extensionPath, 'tools', 'embeddingsearch', binaryName);
    }
  }

  async searchNaturalLanguage(query: string): Promise<EmbeddingSearchResult | null> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.binaryPath)) {
        reject(new Error(`Embedding search binary not found at ${this.binaryPath}`));
        return;
      }

      const process = spawn(this.binaryPath, ['-json', query], {
        cwd: this.extensionPath
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Embedding search failed: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout) as EmbeddingSearchResult;
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse embedding search result: ${error}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  isNaturalLanguageQuery(query: string): boolean {
    // If query starts with a dot, it's an EQL query
    return !query.trim().startsWith('.');
  }
}