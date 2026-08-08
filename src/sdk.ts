export async function unwrap<T>(result: any): Promise<T> {
  const value = await result
  return value?.data !== undefined ? (value.data as T) : (value as T)
}
