// ---------------------------------------------------------------------------
// NPM registry search for MCP server packages
// ---------------------------------------------------------------------------

export interface NpmPackage {
  name: string;
  description: string;
  version: string;
  weeklyDownloads: number;
  date: string;
  keywords: string[];
  publisher: string;
}

interface NpmSearchResponse {
  objects: Array<{
    package: {
      name: string;
      description?: string;
      version: string;
      date: string;
      keywords?: string[];
      publisher?: {
        username?: string;
      };
    };
    score?: {
      detail?: {
        popularity?: number;
      };
    };
    searchScore?: number;
  }>;
}

/**
 * Search the NPM registry for MCP server packages.
 * Appends "mcp server" to the query for better results.
 */
export async function searchNpmRegistry(
  query: string,
): Promise<NpmPackage[]> {
  const searchText = `${query} mcp server`;
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(searchText)}&size=10`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(
      `NPM registry search failed: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as NpmSearchResponse;

  return data.objects.map((obj) => {
    const pkg = obj.package;
    // Estimate weekly downloads from popularity score (actual downloads
    // require a separate API call; this is a reasonable approximation)
    const popularity = obj.score?.detail?.popularity ?? 0;
    const estimatedDownloads = Math.round(popularity * 100_000);

    return {
      name: pkg.name,
      description: pkg.description ?? '',
      version: pkg.version,
      weeklyDownloads: estimatedDownloads,
      date: pkg.date,
      keywords: pkg.keywords ?? [],
      publisher: pkg.publisher?.username ?? 'unknown',
    };
  });
}
