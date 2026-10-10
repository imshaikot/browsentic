// What `browsentic-mcp` runs. An MCP client config names it with no arguments, {"command": "browsentic-mcp"},
// and that means serve. It is a file of its own because npm's shim on Windows starts Node on the file the bin
// points at, so the name it was called by never reaches cli.ts.
if (process.argv.length === 2) process.argv.push('mcp');
await import(new URL('./cli.js', import.meta.url).href);
