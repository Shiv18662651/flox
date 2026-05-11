// Search index worker - syncs customer and product documents to Meilisearch
// Requirements: 15.2, 15.3, 15.4

import { Worker, Job } from 'bullmq'
import { Meilisearch } from 'meilisearch'
import { connection, QUEUES, WORKER_CONFIG, type SearchIndexJob } from './index'

const INDEXES = {
  CUSTOMERS: 'customers',
  PRODUCTS: 'products',
} as const

/**
 * Create a Meilisearch client for the worker process.
 * Workers run in a separate process from the Remix app, so they need their own client.
 */
function createMeilisearchClient(): Meilisearch {
  return new Meilisearch({
    host: process.env.MEILISEARCH_URL || 'http://127.0.0.1:7700',
    apiKey: process.env.MEILISEARCH_MASTER_KEY,
  })
}

/**
 * Process a SEARCH_INDEX job by upserting or deleting a document in Meilisearch.
 */
export async function processSearchIndexJob(
  job: Job<SearchIndexJob>,
  client?: Meilisearch
): Promise<void> {
  const { action, index, documentId, document } = job.data
  const meili = client || createMeilisearchClient()

  const indexName = index === 'customers' ? INDEXES.CUSTOMERS : INDEXES.PRODUCTS

  if (action === 'upsert') {
    if (!document) {
      throw new Error(`SEARCH_INDEX upsert job missing document for ${indexName}/${documentId}`)
    }

    // Meilisearch requires an 'id' field as the primary key
    const doc = { id: documentId, ...document }
    await meili.index(indexName).addDocuments([doc])

    console.log(`[search-worker] Upserted document ${documentId} in ${indexName}`)
  } else if (action === 'delete') {
    await meili.index(indexName).deleteDocument(documentId)

    console.log(`[search-worker] Deleted document ${documentId} from ${indexName}`)
  } else {
    throw new Error(`Unknown search index action: ${action}`)
  }
}

export function createSearchWorker() {
  const config = WORKER_CONFIG[QUEUES.SEARCH_INDEX]

  const worker = new Worker<SearchIndexJob>(
    QUEUES.SEARCH_INDEX,
    processSearchIndexJob,
    {
      connection,
      concurrency: config.concurrency,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: config.backoff,
      },
    }
  )

  worker.on('failed', (job, err) => {
    if (job) {
      console.error(
        `[search-worker] Job ${job.id} failed (attempt ${job.attemptsMade}/${config.attempts}): ${err.message}`
      )
    }
  })

  worker.on('completed', (job) => {
    console.log(`[search-worker] Job ${job.id} completed successfully`)
  })

  return worker
}
