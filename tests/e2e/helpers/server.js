import { createServer } from '../../../src/server.js'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '..', '..', 'fixtures')

/**
 * Start a mdprobe server with fixture files copied to a temp dir.
 * @param {object} opts
 * @param {string[]} opts.files - fixture filenames (e.g. ['sample.md'])
 * @param {boolean} [opts.withAnnotations=false] - copy .annotations.yaml too
 * @param {number} [opts.port=0] - 0 = auto-assign
 * @param {string} [opts.author='e2e-tester'] - author name passed to createServer
 */
export async function startServer({ files, withAnnotations = false, port = 0, author = 'e2e-tester' }) {
  const tmpDir = join(__dirname, '..', '.tmp-' + Date.now())
  mkdirSync(tmpDir, { recursive: true })

  for (const file of files) {
    copyFileSync(join(fixturesDir, file), join(tmpDir, file))
    if (withAnnotations) {
      const yamlName = file.replace(/\.md$/, '.annotations.yaml')
      try {
        copyFileSync(join(fixturesDir, yamlName), join(tmpDir, yamlName))
      } catch {
        // No annotations file for this fixture
      }
    }
  }

  const filePaths = files.map(f => join(tmpDir, f))
  const server = await createServer({
    files: filePaths,
    port,
    open: false,
    author,
  })

  return { server, url: server.url, tmpDir }
}

/**
 * Stop server and clean up temp directory.
 */
export async function stopServer({ server, tmpDir }) {
  await server.close()
  rmSync(tmpDir, { recursive: true, force: true })
}
