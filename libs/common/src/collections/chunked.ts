/** Ids per `$in` query or bulk write. */
export const ID_CHUNK = 1000;

/** The items in consecutive slices of at most `size`, in order. */
export const chunked = <Item>(items: Item[], size = ID_CHUNK): Item[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) =>
    items.slice(index * size, (index + 1) * size),
  );
