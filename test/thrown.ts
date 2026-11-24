/**
 * Calls fn with the arguments and returns what it threw. A test then asserts on that value, so it
 * needs no function of its own: `expect(thrown(parseShift, '26')).toMatchObject({ code })`.
 */
export function thrown<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): unknown {
  try {
    fn(...args);
  } catch (error) {
    return error;
  }
  throw new Error(`${fn.name || 'The function'} returned instead of throwing.`);
}
