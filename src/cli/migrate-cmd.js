import fs from 'node:fs'
import path from 'node:path'
import { migrateFile } from '../anchoring/v2/migrate.js'

function findMarkdownFiles(target) {
  const result = []
  const stat = fs.statSync(target)
  if (stat.isFile()) {
    if (target.endsWith('.md')) result.push(target)
    return result
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) {
      result.push(...findMarkdownFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      result.push(full)
    }
  }
  return result
}

export function runMigrate(target, opts = {}) {
  const { dryRun = false } = opts
  const stats = { migrated: 0, alreadyV2: 0, errors: 0, files: [] }

  // Normalize target to absolute path
  const resolvedTarget = path.resolve(target)
  const mdFiles = findMarkdownFiles(resolvedTarget)

  for (const mdPath of mdFiles) {
    // Replace .md with .annotations.yaml (e.g. doc.md -> doc.annotations.yaml)
    const yamlPath = mdPath.replace(/\.md$/, '.annotations.yaml')
    if (!fs.existsSync(yamlPath)) continue
    try {
      const result = migrateFile(yamlPath, mdPath, { dryRun })
      if (result.migrated) {
        stats.migrated++
        stats.files.push({ path: yamlPath, count: result.count })
        const action = dryRun ? '[dry-run] would migrate' : 'migrated'
        console.log(`${action} ${result.count} annotations in ${path.relative(process.cwd(), mdPath)}`)
      } else {
        stats.alreadyV2++
      }
    } catch (err) {
      stats.errors++
      console.error(`error migrating ${yamlPath}: ${err.message}`)
    }
  }

  console.log(`\n${stats.migrated} migrated, ${stats.alreadyV2} already v2, ${stats.errors} errors`)
  return stats
}
