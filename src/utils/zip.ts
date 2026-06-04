import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'

export type ZipEntryInfo = {
  filename: string
  directory: boolean
  encrypted: boolean
  uncompressedSize?: number
  lastModDate?: Date
}

export type ExtractedZipEntry = ZipEntryInfo & {
  blob: Blob
}

export async function readZipEntries(file: Blob): Promise<ZipEntryInfo[]> {
  const reader = new ZipReader(new BlobReader(file))

  try {
    const entries = await reader.getEntries()

    return entries.map((entry) => ({
      filename: entry.filename,
      directory: entry.directory,
      encrypted: entry.encrypted,
      uncompressedSize: entry.uncompressedSize,
      lastModDate: entry.lastModDate,
    }))
  } finally {
    await reader.close()
  }
}

export async function extractZipEntries(file: Blob, password?: string): Promise<ExtractedZipEntry[]> {
  const reader = new ZipReader(new BlobReader(file))

  try {
    const entries = await reader.getEntries()
    const files = entries.filter((entry) => !entry.directory)

    return Promise.all(
      files.map(async (entry) => {
        const blob = await entry.getData(new BlobWriter(), { password })

        return {
          filename: entry.filename,
          directory: entry.directory,
          encrypted: entry.encrypted,
          uncompressedSize: entry.uncompressedSize,
          lastModDate: entry.lastModDate,
          blob,
        }
      }),
    )
  } finally {
    await reader.close()
  }
}
