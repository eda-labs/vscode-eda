// src/utils/compatibility.ts
import * as semver from 'semver';
import { log, LogLevel } from '../extension';

/**
 * Check Node.js compatibility for ESM imports
 * @returns True if Node.js version supports ESM imports
 */
export function checkNodeCompatibility(): boolean {
  const nodeVersion = process.version;
  const minVersionForESM = 'v14.0.0';
  
  const isCompatible = semver.gte(nodeVersion, minVersionForESM);
  
  if (!isCompatible) {
    log(`Warning: Node.js ${nodeVersion} may not fully support ES Modules. ` +
        `Version ${minVersionForESM} or higher is recommended.`, LogLevel.WARN, true);
  } else {
    log(`Node.js ${nodeVersion} detected. Compatible with ES Modules.`, LogLevel.INFO);
  }
  
  return isCompatible;
}

/**
 * Get import method based on Node.js version
 */
export async function dynamicImport(moduleName: string): Promise<any> {
  try {
    log(`Dynamically importing ${moduleName}...`, LogLevel.DEBUG);
    return await import(moduleName);
  } catch (error) {
    log(`Error importing ${moduleName}: ${error}`, LogLevel.ERROR);
    throw error;
  }
}