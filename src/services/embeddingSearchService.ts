import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

import { fetch, EnvHttpProxyAgent } from 'undici';

import { log, LogLevel } from '../extension';

// Constants for platform identifiers
const PLATFORM_WIN32 = 'win32';
const PLATFORM_DARWIN = 'darwin';
const PLATFORM_LINUX = 'linux';
const ARCH_ARM64 = 'arm64';

// Constants for binary paths (absolute paths to avoid PATH-based command execution)
const TAR_BINARY = '/usr/bin/tar';
const POWERSHELL_BINARY = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

// Base URL for embedding search releases
const RELEASE_BASE_URL = 'https://github.com/FloSch62/eda-embeddingsearch/releases/latest/download';

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
        const binaryName = platform === PLATFORM_WIN32 ? 'embeddingsearch.exe' : 'embeddingsearch';
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

    private getDownloadUrl(platform: string, arch: string): string {
        const archSuffix = arch === ARCH_ARM64 ? 'arm64' : 'amd64';

        if (platform === PLATFORM_DARWIN) {
            return `${RELEASE_BASE_URL}/embeddingsearch-darwin-${archSuffix}.tar.gz`;
        }
        if (platform === PLATFORM_LINUX) {
            return `${RELEASE_BASE_URL}/embeddingsearch-linux-${archSuffix}.tar.gz`;
        }
        if (platform === PLATFORM_WIN32) {
            return `${RELEASE_BASE_URL}/embeddingsearch-windows-amd64.zip`;
        }
        throw new Error(`Unsupported platform: ${platform}`);
    }

    private async downloadBinary(): Promise<void> {
        const platform = os.platform();
        const arch = os.arch();
        const downloadUrl = this.getDownloadUrl(platform, arch);

        log(`Downloading embeddingsearch from ${downloadUrl}`, LogLevel.INFO);

        const proxyEnv = process.env.http_proxy ?? process.env.HTTP_PROXY ?? process.env.https_proxy ?? process.env.HTTPS_PROXY;
        const dispatcher = proxyEnv ? new EnvHttpProxyAgent() : undefined;
        const response = await fetch(downloadUrl, { dispatcher });
        if (!response.ok) {
            throw new Error(`Failed to download: ${response.statusText}`);
        }

        const isWindows = platform === PLATFORM_WIN32;
        const tempFile = path.join(this.edaPath, `embeddingsearch-temp.${isWindows ? 'zip' : 'tar.gz'}`);
        const fileStream = createWriteStream(tempFile);

        if (response.body) {
            await pipeline(response.body, fileStream);
        }

        // Extract the archive
        if (isWindows) {
            await this.extractZip(tempFile, this.edaPath);
        } else {
            await this.extractTarGz(tempFile, this.edaPath);
        }

        // Clean up temp file
        await fs.promises.unlink(tempFile);

        // Make binary executable on Unix-like systems (owner read/write/execute, group/others read/execute)
        if (!isWindows) {
            // eslint-disable-next-line sonarjs/file-permissions -- intentional: downloaded binary must be executable
            await fs.promises.chmod(this.binaryPath, 0o755);
        }
    }

    private async extractTarGz(archivePath: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // Extract and rename in one command using --transform
            // Using absolute path to tar binary to avoid PATH-based command execution
            const tar = spawn(TAR_BINARY, ['-xzf', archivePath, '-C', destPath, '--transform', 's/embeddingsearch-.*/embeddingsearch/']);

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
        // For Windows, we'll use PowerShell to extract and rename
        // Using absolute path to PowerShell binary to avoid PATH-based command execution
        return new Promise((resolve, reject) => {
            const ps = spawn(POWERSHELL_BINARY, [
                '-Command',
                `Expand-Archive -Path "${archivePath}" -DestinationPath "${destPath}" -Force; Get-ChildItem "${destPath}" -Filter "embeddingsearch-*" | Rename-Item -NewName "embeddingsearch.exe" -Force`
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

            setupProcess.stdout.on('data', (data: Buffer) => {
                const text = data.toString();
                output += text;
                // Log progress messages
                const lines = text.split('\n').filter((line) => line.trim());
                for (const line of lines) {
                    if (line.includes('Downloading') || line.includes('Downloaded') ||
                        line.includes('Loading') || line.includes('Loaded') ||
                        line.includes('completed')) {
                        log(`Embeddingsearch: ${line}`, LogLevel.INFO);
                    }
                }
            });

            setupProcess.stderr.on('data', (data: Buffer) => {
                log(`Embeddingsearch setup error: ${data.toString()}`, LogLevel.ERROR);
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

            const searchProcess = spawn(this.binaryPath, ['-json', query], {
                cwd: this.edaPath
            });

            let stdout = '';
            let stderr = '';

            searchProcess.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            searchProcess.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            searchProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Embedding search failed: ${stderr}`));
                    return;
                }

                try {
                    const result = JSON.parse(stdout) as EmbeddingSearchResult;
                    resolve(result);
                } catch (error) {
                    reject(new Error(`Failed to parse embedding search result: ${String(error)}`));
                }
            });

            searchProcess.on('error', (error) => {
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