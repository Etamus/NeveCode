import { readdir, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'path'
import picomatch from 'picomatch'
import type { ToolPermissionContext } from '../Tool.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import { getGlobExclusionsForPluginCache } from './plugins/orphanedPluginFilter.js'
import { ripGrep, RipgrepUnavailableError } from './ripgrep.js'

const DEFAULT_NATIVE_EXCLUDED_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  '.jj',
  '.sl',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'llama-bin',
])

function toSlashPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function isRipgrepMissing(error: unknown): boolean {
  return (
    error instanceof RipgrepUnavailableError ||
    (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')
  )
}

function normalizeExclusionPattern(pattern: string): string {
  const withoutBang = pattern.startsWith('!') ? pattern.slice(1) : pattern
  return toSlashPath(withoutBang.replace(/^\*\*\//, ''))
}

async function nativeGlobFallback(
  searchDir: string,
  searchPattern: string,
  ignorePatterns: string[],
  pluginExclusions: string[],
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
  hidden: boolean,
): Promise<{ files: string[]; truncated: boolean }> {
  const matcher = picomatch(searchPattern, { dot: true, windows: false })
  const ignoreMatchers = [...ignorePatterns, ...pluginExclusions]
    .map(normalizeExclusionPattern)
    .filter(Boolean)
    .map(pattern => picomatch(pattern, { dot: true, windows: false }))
  const matches: Array<{ path: string; mtimeMs: number }> = []

  async function walk(dir: string): Promise<void> {
    if (abortSignal.aborted) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (abortSignal.aborted) return
      if (!hidden && entry.name.startsWith('.')) continue

      const fullPath = join(dir, entry.name)
      const relPath = toSlashPath(relative(searchDir, fullPath))
      const baseName = entry.name

      if (entry.isDirectory()) {
        if (DEFAULT_NATIVE_EXCLUDED_DIRS.has(baseName)) continue
        if (ignoreMatchers.some(matchesIgnore => matchesIgnore(relPath) || matchesIgnore(`${relPath}/`))) continue
        await walk(fullPath)
        continue
      }

      if (!entry.isFile()) continue
      if (ignoreMatchers.some(matchesIgnore => matchesIgnore(relPath))) continue
      if (!matcher(relPath) && !matcher(baseName)) continue

      let mtimeMs = 0
      try {
        mtimeMs = (await stat(fullPath)).mtimeMs ?? 0
      } catch {}
      matches.push({ path: fullPath, mtimeMs })
    }
  }

  await walk(searchDir)

  const sorted = matches
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
    .map(match => match.path)
  const truncated = sorted.length > offset + limit
  const files = sorted.slice(offset, offset + limit)

  return { files, truncated }
}

/**
 * Extracts the static base directory from a glob pattern.
 * The base directory is everything before the first glob special character (* ? [ {).
 * Returns the directory portion and the remaining relative pattern.
 */
export function extractGlobBaseDirectory(pattern: string): {
  baseDir: string
  relativePattern: string
} {
  // Find the first glob special character: *, ?, [, {
  const globChars = /[*?[{]/
  const match = pattern.match(globChars)

  if (!match || match.index === undefined) {
    // No glob characters - this is a literal path
    // Return the directory portion and filename as pattern
    const dir = dirname(pattern)
    const file = basename(pattern)
    return { baseDir: dir, relativePattern: file }
  }

  // Get everything before the first glob character
  const staticPrefix = pattern.slice(0, match.index)

  // Find the last path separator in the static prefix
  const lastSepIndex = Math.max(
    staticPrefix.lastIndexOf('/'),
    staticPrefix.lastIndexOf(sep),
  )

  if (lastSepIndex === -1) {
    // No path separator before the glob - pattern is relative to cwd
    return { baseDir: '', relativePattern: pattern }
  }

  let baseDir = staticPrefix.slice(0, lastSepIndex)
  const relativePattern = pattern.slice(lastSepIndex + 1)

  // Handle root directory patterns (e.g., /*.txt on Unix or C:/*.txt on Windows)
  // When lastSepIndex is 0, baseDir is empty but we need to use '/' as the root
  if (baseDir === '' && lastSepIndex === 0) {
    baseDir = '/'
  }

  // Handle Windows drive root paths (e.g., C:/*.txt)
  // 'C:' means "current directory on drive C" (relative), not root
  // We need 'C:/' or 'C:\' for the actual drive root
  if (getPlatform() === 'windows' && /^[A-Za-z]:$/.test(baseDir)) {
    baseDir = baseDir + sep
  }

  return { baseDir, relativePattern }
}

export async function glob(
  filePattern: string,
  cwd: string,
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
  toolPermissionContext: ToolPermissionContext,
): Promise<{ files: string[]; truncated: boolean }> {
  let searchDir = cwd
  let searchPattern = filePattern

  // Handle absolute paths by extracting the base directory and converting to relative pattern
  // ripgrep's --glob flag only works with relative patterns
  if (isAbsolute(filePattern)) {
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern)
    if (baseDir) {
      searchDir = baseDir
      searchPattern = relativePattern
    }
  }

  const ignorePatterns = normalizePatternsToPath(
    getFileReadIgnorePatterns(toolPermissionContext),
    searchDir,
  )

  // Use ripgrep for better memory performance
  // --files: list files instead of searching content
  // --glob: filter by pattern
  // --sort=modified: sort by modification time (oldest first)
  // --no-ignore: don't respect .gitignore (default true, set CLAUDE_CODE_GLOB_NO_IGNORE=false to respect .gitignore)
  // --hidden: include hidden files (default true, set CLAUDE_CODE_GLOB_HIDDEN=false to exclude)
  // Note: use || instead of ?? to treat empty string as unset (defaulting to true)
  const noIgnore = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_NO_IGNORE || 'true')
  const hidden = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_HIDDEN || 'true')
  const args = [
    '--files',
    '--glob',
    searchPattern,
    '--sort=modified',
    ...(noIgnore ? ['--no-ignore'] : []),
    ...(hidden ? ['--hidden'] : []),
  ]

  // Add ignore patterns
  for (const pattern of ignorePatterns) {
    args.push('--glob', `!${pattern}`)
  }

  // Exclude orphaned plugin version directories
  const pluginExclusions = await getGlobExclusionsForPluginCache(searchDir)
  for (const exclusion of pluginExclusions) {
    args.push('--glob', exclusion)
  }

  let allPaths: string[]
  try {
    allPaths = await ripGrep(args, searchDir, abortSignal)
  } catch (error) {
    if (!isRipgrepMissing(error)) throw error
    return nativeGlobFallback(
      searchDir,
      searchPattern,
      ignorePatterns,
      pluginExclusions,
      { limit, offset },
      abortSignal,
      hidden,
    )
  }

  // ripgrep returns relative paths, convert to absolute
  const absolutePaths = allPaths.map(p =>
    isAbsolute(p) ? p : join(searchDir, p),
  )

  const truncated = absolutePaths.length > offset + limit
  const files = absolutePaths.slice(offset, offset + limit)

  return { files, truncated }
}
