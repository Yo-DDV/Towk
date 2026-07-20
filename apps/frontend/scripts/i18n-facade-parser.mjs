export function parseMessageFunctionNames(source) {
  return [...source.matchAll(/^export (?:declare )?const ([A-Za-z0-9_]+):/gm)].map(
    ([, name]) => name
  );
}

export function parseMessageInputTypes(source) {
  return new Map(
    [...source.matchAll(/^export type ([A-Za-z0-9_]+Inputs) = ([\s\S]*?);\n/gm)].map(
      ([, typeName, body]) => [typeName, body.trim()]
    )
  );
}
