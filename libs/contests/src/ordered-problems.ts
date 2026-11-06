/** A contest's problems by `order`: the stored array is not kept sorted, and the position in this order is the problem's label. */
export const orderedProblems = <Problem extends { order: number }>(contest: {
  problems: readonly Problem[];
}): Problem[] =>
  [...contest.problems].sort((left, right) => left.order - right.order);
