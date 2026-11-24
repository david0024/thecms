/** A file imported as its text (`with { type: 'text' }`). */
declare module '*.css' {
  const text: string;
  export default text;
}
declare module '*.uhlaka-extension' {
  const text: string;
  export default text;
}
/** A file imported as its path (`with { type: 'file' }`); inside the single executable, a path into it. */
declare module '*.woff2' {
  const path: string;
  export default path;
}
