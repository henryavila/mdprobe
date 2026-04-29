import yaml from 'js-yaml'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { needsMigration, migrateFile } from './anchoring/v2/migrate.js'

const VALID_TAGS = ['bug', 'question', 'suggestion', 'nitpick']

/**
 * Validates that a tag is one of the allowed values.
 * @param {string} tag
 * @throws {Error} if tag is not in VALID_TAGS
 */
function validateTag(tag) {
  if (!VALID_TAGS.includes(tag)) {
    throw new Error(`Invalid tag "${tag}". Must be one of: ${VALID_TAGS.join(', ')}`)
  }
}

/**
 * Generates a short unique identifier.
 * @returns {string}
 */
function generateId() {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * Manages annotation data for a Markdown source file.
 *
 * Supports CRUD operations on annotations, section approval tracking,
 * persistence to/from YAML, and export to JSON and SARIF formats.
 */
export class AnnotationFile {
  /**
   * @param {object} data - Raw annotation file data
   * @param {number} data.version
   * @param {string} data.source
   * @param {string} data.source_hash
   * @param {Array} data.annotations
   * @param {Array} data.sections
   */
  constructor(data) {
    this.version = data.version
    this.source = data.source
    this.sourceHash = data.source_hash
    this.annotations = data.annotations ?? []
    this.sections = data.sections ?? []

    // Ensure every annotation has a replies array and backfill missing reply ids
    for (const ann of this.annotations) {
      if (!ann.replies) {
        ann.replies = []
      }
      for (const reply of ann.replies) {
        if (!reply.id) reply.id = randomUUID()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Static factory methods
  // ---------------------------------------------------------------------------

  /**
   * Creates a new empty AnnotationFile for a given source.
   * @param {string} source - Source markdown filename
   * @param {string} sourceHash - Hash of the source file (e.g. "sha256:abc123")
   * @returns {AnnotationFile}
   */
  static create(source, sourceHash) {
    return new AnnotationFile({
      version: 1,
      source,
      source_hash: sourceHash,
      annotations: [],
      sections: [],
    })
  }

  /**
   * Loads an AnnotationFile from a YAML file on disk.
   * @param {string} yamlPath - Absolute path to the YAML file
   * @returns {Promise<AnnotationFile>}
   * @throws {Error} if the file does not exist or contains invalid YAML
   */
  static async load(yamlPath) {
    if (needsMigration(yamlPath)) {
      const mdPath = yamlPath.replace(/\.annotations\.yaml$/, '.md')
      try {
        const result = migrateFile(yamlPath, mdPath)
        if (result.migrated) {
          console.log(`mdprobe: migrated ${result.count} annotations to schema v2 in ${path.basename(mdPath)} (backup: ${path.basename(result.backupPath)})`)
        }
      } catch (err) {
        console.error(`mdprobe: failed to migrate ${yamlPath}: ${err.message}`)
      }
    }

    const content = await readFile(yamlPath, 'utf-8')

    let data
    try {
      data = yaml.load(content)
    } catch (err) {
      // js-yaml errors include a `mark` with line info; re-throw with line context
      if (err.mark != null) {
        throw new Error(`Invalid YAML at line ${err.mark.line + 1}: ${err.message}`)
      }
      throw new Error(`Invalid YAML (line unknown): ${err.message}`)
    }

    return new AnnotationFile({
      version: data.version,
      source: data.source,
      source_hash: data.source_hash,
      annotations: data.annotations ?? [],
      sections: data.sections ?? [],
    })
  }

  // ---------------------------------------------------------------------------
  // CRUD — annotations
  // ---------------------------------------------------------------------------

  /**
   * Adds a new annotation.
   * @param {object} opts
   * @param {object} opts.selectors - Position/quote selectors (required)
   * @param {string} opts.comment - Annotation text (required)
   * @param {string} opts.tag - One of VALID_TAGS
   * @param {string} opts.author - Author name
   * @returns {object} the created annotation
   */
  add({ selectors, comment, tag, author }) {
    if (!selectors) {
      throw new Error('selectors is required')
    }
    if (!comment) {
      throw new Error('comment is required')
    }
    validateTag(tag)

    const now = new Date().toISOString()
    const annotation = {
      id: generateId(),
      selectors,
      comment,
      tag,
      status: 'open',
      author,
      created_at: now,
      updated_at: now,
      replies: [],
    }

    this.annotations.push(annotation)
    return annotation
  }

  /**
   * Resolves an annotation by id. Idempotent.
   * @param {string} id
   * @throws {Error} if annotation not found
   */
  resolve(id) {
    const ann = this._findOrThrow(id)
    ann.status = 'resolved'
    ann.updated_at = new Date().toISOString()
  }

  /**
   * Reopens a previously resolved annotation.
   * @param {string} id
   * @throws {Error} if annotation not found
   */
  reopen(id) {
    const ann = this._findOrThrow(id)
    ann.status = 'open'
    ann.updated_at = new Date().toISOString()
  }

  /**
   * Updates the comment text of an annotation.
   * @param {string} id
   * @param {string} text - New comment (must be non-empty)
   * @throws {Error} if id not found or text is empty
   */
  updateComment(id, text) {
    if (!text) {
      throw new Error('comment text must not be empty')
    }
    const ann = this._findOrThrow(id)
    ann.comment = text
    ann.updated_at = new Date().toISOString()
  }

  /**
   * Updates the tag of an annotation.
   * @param {string} id
   * @param {string} tag - New tag (must be valid)
   * @throws {Error} if id not found or tag is invalid
   */
  updateTag(id, tag) {
    validateTag(tag)
    const ann = this._findOrThrow(id)
    ann.tag = tag
    ann.updated_at = new Date().toISOString()
  }

  /**
   * Deletes an annotation by id.
   * @param {string} id
   * @throws {Error} if annotation not found
   */
  delete(id) {
    const index = this.annotations.findIndex(a => a.id === id)
    if (index === -1) {
      throw new Error(`Annotation "${id}" not found`)
    }
    this.annotations.splice(index, 1)
  }

  /**
   * Adds a reply to an existing annotation.
   * @param {string} annotationId
   * @param {object} opts
   * @param {string} opts.author
   * @param {string} opts.comment
   * @throws {Error} if annotation not found
   */
  addReply(annotationId, { author, comment }) {
    const ann = this._findOrThrow(annotationId)
    ann.replies.push({
      id: randomUUID(),
      author,
      comment,
      created_at: new Date().toISOString(),
    })
  }

  editReply(annotationId, replyId, comment) {
    const ann = this._findOrThrow(annotationId)
    const reply = ann.replies.find(r => r.id === replyId)
    if (!reply) throw new Error(`Reply ${replyId} not found on ${annotationId}`)
    reply.comment = comment
    reply.updated_at = new Date().toISOString()
  }

  deleteReply(annotationId, replyId) {
    const ann = this._findOrThrow(annotationId)
    const before = ann.replies.length
    ann.replies = ann.replies.filter(r => r.id !== replyId)
    if (ann.replies.length === before) throw new Error(`Reply ${replyId} not found on ${annotationId}`)
  }

  /**
   * Accepts a drifted annotation's new location by updating its range and
   * contextHash, then resetting status to 'open'.
   * @param {string} annotationId
   * @param {{ start: number, end: number }} currentRange
   * @param {string} currentContextHash
   */
  acceptDrift(annotationId, currentRange, currentContextHash) {
    const ann = this._findOrThrow(annotationId)
    ann.range = currentRange
    if (!ann.anchor) ann.anchor = {}
    ann.anchor.contextHash = currentContextHash
    ann.status = 'open'
    ann.updated_at = new Date().toISOString()
  }

  // ---------------------------------------------------------------------------
  // Query methods
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a single annotation by id.
   * @param {string} id
   * @returns {object}
   * @throws {Error} if not found
   */
  getById(id) {
    return this._findOrThrow(id)
  }

  /**
   * Returns all open annotations.
   * @returns {Array}
   */
  getOpen() {
    return this.annotations.filter(a => a.status === 'open')
  }

  /**
   * Returns all resolved annotations.
   * @returns {Array}
   */
  getResolved() {
    return this.annotations.filter(a => a.status === 'resolved')
  }

  /**
   * Returns annotations matching a given tag.
   * @param {string} tag
   * @returns {Array}
   */
  getByTag(tag) {
    return this.annotations.filter(a => a.tag === tag)
  }

  /**
   * Returns annotations by a given author.
   * @param {string} author
   * @returns {Array}
   */
  getByAuthor(author) {
    return this.annotations.filter(a => a.author === author)
  }

  // ---------------------------------------------------------------------------
  // Section approval
  // ---------------------------------------------------------------------------

  /**
   * Sets a section's status to 'approved'.
   * @param {string} heading
   * @throws {Error} if section not found
   */
  approveSection(heading) {
    this._cascadeStatus(heading, 'approved')
  }

  /**
   * Set status on a section and cascade to all descendants.
   * @param {string} heading
   * @param {string} status
   */
  _cascadeStatus(heading, status) {
    const target = this._findSectionOrThrow(heading)
    target.status = status
    if (target.level != null) {
      const idx = this.sections.indexOf(target)
      for (let i = idx + 1; i < this.sections.length; i++) {
        if (this.sections[i].level == null || this.sections[i].level <= target.level) break
        this.sections[i].status = status
      }
    }
  }

  /**
   * Compute effective status for each section considering children.
   * Returns a new array with { heading, level, status, computed } where
   * `computed` is 'indeterminate' when children have mixed statuses.
   */
  computeStatus() {
    return computeSectionStatus(this.sections)
  }

  /**
   * Sets a section's status to 'rejected'. Cascades to descendants.
   * @param {string} heading
   * @throws {Error} if section not found
   */
  rejectSection(heading) {
    this._cascadeStatus(heading, 'rejected')
  }

  /**
   * Resets a section's status to 'pending'. Cascades to descendants.
   * @param {string} heading
   * @throws {Error} if section not found
   */
  resetSection(heading) {
    this._cascadeStatus(heading, 'pending')
  }

  /**
   * Sets all sections to 'approved'.
   */
  approveAll() {
    for (const section of this.sections) {
      section.status = 'approved'
    }
  }

  /**
   * Sets all sections to 'pending'.
   */
  clearAll() {
    for (const section of this.sections) {
      section.status = 'pending'
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence & export
  // ---------------------------------------------------------------------------

  /**
   * Saves the annotation file to disk as human-readable YAML.
   * @param {string} yamlPath - Absolute path for the output file
   * @returns {Promise<void>}
   */
  async save(yamlPath) {
    const data = this.toJSON()
    const content = yaml.dump(data, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    })
    await writeFile(yamlPath, content, 'utf-8')
  }

  /**
   * Returns a plain JSON-serializable object representation.
   * Uses underscore `source_hash` per spec.
   * @returns {object}
   */
  toJSON() {
    return {
      version: this.version,
      source: this.source,
      source_hash: this.sourceHash,
      sections: this.sections,
      annotations: this.annotations.map(ann => ({
        id: ann.id,
        selectors: ann.selectors,
        comment: ann.comment,
        tag: ann.tag,
        status: ann.status,
        author: ann.author,
        created_at: ann.created_at,
        updated_at: ann.updated_at,
        replies: ann.replies ?? [],
      })),
    }
  }

  /**
   * Returns a SARIF 2.1.0 object with open annotations as results.
   * @returns {object}
   */
  toSARIF() {
    const openAnnotations = this.getOpen()

    return {
      $schema:
        'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'mdProbe',
              version: '0.1.0',
              informationUri: 'https://github.com/henryavila/mdprobe',
            },
          },
          results: openAnnotations.map(ann => {
            const result = {
              ruleId: ann.tag,
              level: ann.tag === 'bug' ? 'error' : 'note',
              message: { text: ann.comment },
              locations: [],
            }

            if (ann.selectors?.position) {
              const pos = ann.selectors.position
              result.locations.push({
                physicalLocation: {
                  artifactLocation: { uri: this.source },
                  region: {
                    startLine: pos.startLine,
                    ...(pos.startColumn != null && { startColumn: pos.startColumn }),
                    ...(pos.endLine != null && { endLine: pos.endLine }),
                    ...(pos.endColumn != null && { endColumn: pos.endColumn }),
                  },
                },
              })
            }

            return result
          }),
        },
      ],
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Finds an annotation by id or throws.
   * @param {string} id
   * @returns {object}
   * @private
   */
  _findOrThrow(id) {
    const ann = this.annotations.find(a => a.id === id)
    if (!ann) {
      throw new Error(`Annotation "${id}" not found`)
    }
    return ann
  }

  /**
   * Finds a section by heading or throws.
   * @param {string} heading
   * @returns {object}
   * @private
   */
  _findSectionOrThrow(heading) {
    const section = this.sections.find(s => s.heading === heading)
    if (!section) {
      throw new Error(`Section "${heading}" not found`)
    }
    return section
  }
}

/**
 * Compute effective status for each section considering children.
 * Walks bottom-up so children are resolved before parents.
 * @param {Array<{heading: string, level?: number, status: string}>} sections
 * @returns {Array<{heading: string, level?: number, status: string, computed: string}>}
 */
export function computeSectionStatus(sections) {
  const result = sections.map(s => ({ ...s, computed: s.status }))

  for (let i = result.length - 1; i >= 0; i--) {
    const section = result[i]
    if (section.level == null) continue

    const children = []
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].level == null || result[j].level <= section.level) break
      children.push(result[j])
    }

    if (children.length === 0) continue

    const statuses = new Set(children.map(c => c.computed))
    if (statuses.size === 1) {
      section.computed = [...statuses][0]
    } else {
      section.computed = 'indeterminate'
    }
  }

  return result
}
