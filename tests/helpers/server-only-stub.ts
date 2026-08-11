/**
 * Test stand-in for the `server-only` marker package.
 *
 * `server-only` resolves to a throwing module unless the `react-server` export
 * condition is enabled. Enabling that condition globally in Vitest would also
 * make `react` resolve to its RSC build, which cannot render in jsdom. Aliasing
 * the marker to this no-op keeps both halves of the suite working: node tests
 * import server modules freely, and jsdom tests render React normally.
 *
 * The real import stays in the source files, so the production bundler still
 * refuses to pull server code into a client bundle.
 */
export {};
