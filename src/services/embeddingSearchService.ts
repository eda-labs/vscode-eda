import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { fetch, EnvHttpProxyAgent } from 'undici';
import { log, LogLevel } from '../extension';

export interface EmbeddingSearchResult {
  topMatch: {
    score: number;
    query: string;
    table: string;
    description?: string;
    availableFields?: string[];
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
    description?: string;
    availableFields?: string[];
  }>;
}

export class EmbeddingSearchService {
    private static instance: EmbeddingSearchService;
    private isSetupComplete = false;
    private setupPromise: Promise<void> | null = null;
    private readonly edaPath: string;
    private readonly binaryPath: string;

    private constructor() {
        this.edaPath = path.join(os.homedir(), '.eda', 'vscode');
        const platform = os.platform();
        const binaryName = platform === 'win32' ? 'embeddingsearch.exe' : 'embeddingsearch';
        this.binaryPath = path.join(this.edaPath, binaryName);
    }

    static getInstance(): EmbeddingSearchService {
        if (!EmbeddingSearchService.instance) {
            EmbeddingSearchService.instance = new EmbeddingSearchService();
        }
        return EmbeddingSearchService.instance;
    }

    async initialize(): Promise<void> {
        if (this.setupPromise) {
            return this.setupPromise;
        }

        this.setupPromise = this.performSetup();
        return this.setupPromise;
    }

    private async performSetup(): Promise<void> {
        try {
            log('Starting embeddingsearch setup in background', LogLevel.INFO);

            // Ensure directories exist
            await fs.promises.mkdir(this.edaPath, { recursive: true });

            // Always download the latest binary
            await this.downloadBinary();

            // Always run setup - the binary will handle whether embeddings need to be downloaded
            await this.runSetup();

            this.isSetupComplete = true;
            log('Embeddingsearch setup completed successfully', LogLevel.INFO);
        } catch (error) {
            log(`Failed to setup embeddingsearch: ${error}`, LogLevel.ERROR);
            // Don't throw - allow the extension to continue working without NL queries
        }
    }

    private async downloadBinary(): Promise<void> {
        const platform = os.platform();
        const arch = os.arch();

        let downloadUrl: string;

        if (platform === 'darwin') {
            if (arch === 'arm64') {
                downloadUrl = 'https://github.com/FloSch62/eda-embeddingsearch/releases/latest/download/embeddingsearch-darwin-arm64.tar.gz';
            } else {
                downloadUrl = 'https://github.com/FloSch62/eda-embeddingsearch/releases/latest/download/embeddingsearch-darwin-amd64.tar.gz';
            }
        } else if (platform === 'linux') {
            if (arch === 'arm64') {
                downloadUrl = 'https://github.com/FloSch62/eda-embeddingsearch/releases/latest/download/embeddingsearch-linux-arm64.tar.gz';
            } else {
                downloadUrl = 'https://github.com/FloSch62/eda-embeddingsearch/releases/latest/download/embeddingsearch-linux-amd64.tar.gz';
            }
        } else if (platform === 'win32') {
            downloadUrl = 'https://github.com/FloSch62/eda-embeddingsearch/releases/latest/download/embeddingsearch-windows-amd64.zip';
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        log(`Downloading embeddingsearch from ${downloadUrl}`, LogLevel.INFO);

        const proxyEnv = process.env.http_proxy || process.env.HTTP_PROXY || process.env.https_proxy || process.env.HTTPS_PROXY;
        const dispatcher = proxyEnv ? new EnvHttpProxyAgent() : undefined;
        const response = await fetch(downloadUrl, { dispatcher });
        if (!response.ok) {
            throw new Error(`Failed to download: ${response.statusText}`);
        }

        const tempFile = path.join(this.edaPath, `embeddingsearch-temp.${platform === 'win32' ? 'zip' : 'tar.gz'}`);
        const fileStream = createWriteStream(tempFile);

        await pipeline(response.body as any, fileStream);

        // Extract the archive
        if (platform === 'win32') {
            await this.extractZip(tempFile, this.edaPath);
        } else {
            await this.extractTarGz(tempFile, this.edaPath);
        }

        // Clean up temp file
        await fs.promises.unlink(tempFile);

        // Make binary executable on Unix-like systems
        if (platform !== 'win32') {
            await fs.promises.chmod(this.binaryPath, 0o755);
        }
    }

    private async extractTarGz(archivePath: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tar = spawn('tar', ['-xzf', archivePath, '-C', destPath]);

            tar.on('error', reject);
            tar.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`tar extraction failed with code ${code}`));
                }
            });
        });
    }

    private async extractZip(archivePath: string, destPath: string): Promise<void> {
        // For Windows, we'll use PowerShell to extract
        return new Promise((resolve, reject) => {
            const ps = spawn('powershell', [
                '-Command',
                `Expand-Archive -Path "${archivePath}" -DestinationPath "${destPath}" -Force`
            ]);

            ps.on('error', reject);
            ps.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`zip extraction failed with code ${code}`));
                }
            });
        });
    }

    private async runSetup(): Promise<void> {
        return new Promise((resolve, reject) => {
            log('Running embeddingsearch setup...', LogLevel.INFO);

            const setupProcess = spawn(this.binaryPath, ['setup'], {
                cwd: this.edaPath
            });

            let output = '';

            setupProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                // Log progress messages
                const lines = text.split('\n').filter((line: string) => line.trim());
                lines.forEach((line: string) => {
                    if (line.includes('Downloading') || line.includes('Downloaded') ||
                        line.includes('Loading') || line.includes('Loaded') ||
                        line.includes('completed')) {
                        log(`Embeddingsearch: ${line}`, LogLevel.INFO);
                    }
                });
            });

            setupProcess.stderr.on('data', (data) => {
                log(`Embeddingsearch setup error: ${data}`, LogLevel.ERROR);
            });

            setupProcess.on('error', (error) => {
                reject(new Error(`Failed to run embeddingsearch setup: ${error.message}`));
            });

            setupProcess.on('exit', (code) => {
                if (code === 0) {
                    if (output.includes('setup completed')) {
                        resolve();
                    } else {
                        reject(new Error('Setup completed but without expected confirmation'));
                    }
                } else {
                    reject(new Error(`embeddingsearch setup failed with code ${code}`));
                }
            });
        });
    }

    async searchNaturalLanguage(query: string): Promise<EmbeddingSearchResult | null> {
        if (!this.isSetupComplete) {
            throw new Error('Embeddingsearch is not ready yet. Please wait for setup to complete.');
        }

        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this.binaryPath)) {
                reject(new Error(`Embedding search binary not found at ${this.binaryPath}`));
                return;
            }

            const process = spawn(this.binaryPath, ['-json', query], {
                cwd: this.edaPath
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

    isReady(): boolean {
        return this.isSetupComplete;
    }

    async waitForSetup(): Promise<void> {
        if (this.isSetupComplete) {
            return;
        }

        if (this.setupPromise) {
            await this.setupPromise;
        }
    }
}