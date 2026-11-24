const major = Number(process.versions.node.split('.')[0])
if (major < 20) {
  console.error(`\nSales Pulse needs Node.js 20 or newer. You have ${process.versions.node}.\nInstall the LTS version from https://nodejs.org and run "npm start" again.\n`)
  process.exit(1)
}
