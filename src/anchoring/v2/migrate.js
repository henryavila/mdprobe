import fs from 'node:fs'
import yaml from 'js-yaml'
import { detectVersion, transformV1ToV2Essential } from './schema.js'

export function needsMigration(yamlPath) {
  if (!fs.existsSync(yamlPath)) return false
  try {
    const obj = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
    return detectVersion(obj) < 2
  } catch {
    return false
  }
}

export function migrateFile(yamlPath, mdPath, opts = {}) {
  const { dryRun = false } = opts
  if (!fs.existsSync(yamlPath)) return { migrated: false, reason: 'no-yaml' }

  const yamlObj = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
  if (detectVersion(yamlObj) >= 2) return { migrated: false }

  if (!fs.existsSync(mdPath)) return { migrated: false, reason: 'no-md' }
  const source = fs.readFileSync(mdPath, 'utf8')

  const v2 = transformV1ToV2Essential(yamlObj, source)
  const count = (v2.annotations || []).length

  if (dryRun) return { migrated: true, dryRun: true, count }

  fs.copyFileSync(yamlPath, yamlPath + '.bak')

  const tmpPath = yamlPath + '.tmp'
  fs.writeFileSync(tmpPath, yaml.dump(v2))
  fs.renameSync(tmpPath, yamlPath)

  return { migrated: true, count, backupPath: yamlPath + '.bak' }
}
