const { program } = require('commander')
const fs = require('fs')
const path = require('path')
const { scan_bdortho_links, shell } = require('./bdortho')

program
  .description('Downloads the list of archive links for IGN BDORTHO and ORTHOHR images.')
  .requiredOption('-o, --out-dir <directory>', 'output directory where to store download links', 'links')
  .requiredOption('-c, --county <value>', 'define this to only fetch download links for the given county', 'all')
program.parse(process.argv)
const opts = program.opts()

const out_dir = path.join(
  path.isAbsolute(opts.outDir)
    ? opts.outDir
    : path.join(process.cwd(), opts.outDir))

fs.mkdirSync(out_dir, { recursive: true })

scan_bdortho_links().then(db => {
  // cleanup output folder first
  shell(`rm -f ${out_dir}/*.lst`)

  for (const dep in db) {
    if (opts.county && opts.county !== 'all' && opts.county !== dep) continue

    for (const dataset of db[dep]) {
      const res = dataset.res > 100 ? `${dataset.res / 100}m` : `${dataset.res}cm`
      const fd = fs.openSync(path.join(out_dir, `${dep}.${res}.${dataset.pva}.lst`), 'w')
      fs.writeSync(fd, dataset.links.join('\n'))
      fs.writeSync(fd, '\n')
      fs.closeSync(fd)
    }
  }
}).catch((err) => {
  console.error(`Failed fetching links : ${err}`)
})
