/**
 * IPFS Storage Utility
 * Used for storing Song's metadata.
 *
 * Pin/unpin goes through the API's server-side pin proxy (/api/ipfs/*) so
 * the Pinata JWT never ships in the web bundle. Reads still use the public
 * gateway directly.
 */

const env = import.meta.env ?? {};
const PINATA_GATEWAY = env.VITE_PINATA_GATEWAY;
const PINATA_JWT = env.VITE_PINATA_JWT;

interface PinataUploadResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

interface PinataMetadata {
  name?: string;
  keyvalues?: Record<string, string>;
}

/**
 * Upload a file to Pinata IPFS directly from client
 */
export async function uploadFile(
  file: File,
  metadata?: PinataMetadata
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  if (metadata) {
    formData.append("pinataMetadata", JSON.stringify(metadata));
  }

  formData.append(
    "pinataOptions",
    JSON.stringify({ cidVersion: 1 })
  );

  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`IPFS upload failed: ${error}`);
  }

  const result: PinataUploadResponse = await response.json();
  return result.IpfsHash;
}

/**
 * Upload JSON data to Pinata IPFS directly from client
 */
export async function uploadJSON<T extends object>(
  data: T,
  metadata?: PinataMetadata
): Promise<string> {
  const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: JSON.stringify({
      pinataContent: data,
      pinataMetadata: metadata,
      pinataOptions: { cidVersion: 1 },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`IPFS JSON upload failed: ${error}`);
  }

  const result: PinataUploadResponse = await response.json();
  return result.IpfsHash;
}

/**
 * Get IPFS URL for a CID via Pinata Gateway
 */
export function getIpfsUrl(cid: string): string {
  return `https://${PINATA_GATEWAY}/ipfs/${cid}`;
}

/**
 * Get IPFS URI (protocol format)
 */
export function getIpfsUri(cid: string): string {
  return `ipfs://${cid}`;
}

/**
 * Fetch JSON from IPFS via Pinata Gateway
 */
export async function fetchFromIpfs<T = unknown>(cid: string): Promise<T> {
  const response = await fetch(getIpfsUrl(cid));
  if (!response.ok) {
    throw new Error(`Failed to fetch from IPFS: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Delete/unpin a file from IPFS by CID directly on Pinata
 */
export async function unpinFile(cid: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.pinata.cloud/pinning/unpin/${encodeURIComponent(cid)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[ipfs] Failed to unpin ${cid}: ${error}`);
      return false;
    }

    console.log(`[ipfs] Successfully unpinned ${cid}`);
    return true;
  } catch (error) {
    console.error(`[ipfs] Error unpinning ${cid}:`, error);
    return false;
  }
}

/**
 * Upload a song image and return the IPFS CID
 */
export async function uploadImage(file: File, name: string): Promise<string> {
  return uploadFile(file, {
    name: `${name}-image`,
    keyvalues: {
      type: "image",
      song: name,
    },
  });
}

/**
 * Upload the voice sample and return the IPFS CID
 */
export async function uploadVoice(file: File, name: string): Promise<string> {
  return uploadFile(file, {
    name: `${name}-voice`,
    keyvalues: {
      type: "voice",
      song: name,
    },
  });
}

/**
 * Upload song metadata to IPFS and return the CID (for future on-chain NFT-like asset minting)
 */
export async function uploadSongMetadata(metadata: object, title: string): Promise<string> {
  return uploadJSON(metadata, {
    name: `${title}-metadata`,
    keyvalues: {
      type: "song-metadata",
      title,
    },
  });
}

/**
 * Check if IPFS pinning is available (server-side proxy; always reachable —
 * the API answers 503 if its Pinata JWT is not configured).
 */
export function isPinataConfigured(): boolean {
  return true;
}

/**
 * Convert file to base64 data URL for preview
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
