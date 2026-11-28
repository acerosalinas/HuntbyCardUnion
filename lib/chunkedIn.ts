/**
 * Runs an "id IN (...)" lookup in batches. A long list of ids goes into the request address, and past a few hundred of them the database
 * rejects the whole request ("Bad Request"); a page that ignored that error showed blanks instead (the Proofs page named every card "Card").
 * This splits the ids into batches, joins the results, and throws if any batch fails, so a problem is loud instead of silent.
 */
export async function selectIn<T>(
  ids: readonly string[],
  run: (batch: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  batchSize = 100,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += batchSize) {
    const { data, error } = await run(unique.slice(i, i + batchSize));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}
