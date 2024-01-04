const { program } = require('commander')
const { BDORTHO_BUCKET, scan_bdortho_bucket, exec } = require('./bdortho')

program
  .description('Only keep latest images on the IGN bucket.')
  .option('-d, --dry-run', 'do not perform cleanup, only print actions')
program.parse(process.argv)
const opts = program.opts()

const delete_list = []
const remotedb = scan_bdortho_bucket()
for (const dep in remotedb) {
  // only keep best res & best pva
  let bestres = null
  let bestpva = null
  for (const dataset of remotedb[dep]) {
    if (dataset.res === 500)
      continue

    if (bestres && (dataset.res > bestres || ( dataset.res === bestres && dataset.pva < bestpva)))
      continue

    bestres = dataset.res
    bestpva = dataset.pva
  }

  for (const dataset of remotedb[dep]) {
    // always keep 5m
    if (dataset.res === 500)
      continue

    if (dataset.res !== bestres || dataset.pva !== bestpva)
      delete_list.push(dataset.path)
  }
}

for (const item of delete_list) {
  const path = `${BDORTHO_BUCKET}/${item}`
  console.log(`Deleting ${path}`)
  if (!opts.dryRun) {
    exec('rclone', [ 'purge', `${path}` ])
  }
}
