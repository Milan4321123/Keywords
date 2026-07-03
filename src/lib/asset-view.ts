'use client';

import { Asset } from '@/types';

/** Open an asset via a fresh signed URL (permission-checked, private-bucket safe). */
export async function openAsset(asset: Asset): Promise<void> {
  try {
    const response = await fetch(`/api/assets/${asset.id}/url`);
    const { data } = await response.json();
    window.open(data?.url ?? asset.file_url, '_blank');
  } catch {
    window.open(asset.file_url, '_blank');
  }
}
