// Přepis příchozích odkazů (SPEC § 10.1): App Link / Universal Link míří na
// webovou stránku `/qes/sign` (resp. `/qes/app`), ale routy appky jsou `/sign`
// (resp. `/`). Custom scheme `dokulachtan://sign?token=…` odpovídá routě přímo,
// takže se beze změny vrací.
const APP_LINK = /^(?:https?:\/\/[^/?#]+)?\/qes(\/[^?#]*)?(\?[^#]*)?$/;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const match = path.match(APP_LINK);

  if (!match) {
    return path;
  }

  const route = match[1] === undefined || match[1] === '/app' ? '/' : match[1];

  return `${route}${match[2] ?? ''}`;
}
