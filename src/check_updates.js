const path = require('path')
const fs = require('fs')
const os = require('os')
const { program } = require('commander')
const { scan_bdortho_links, scan_bdortho_bucket, shell, slack } = require('./bdortho')

function slack_report(report, hostname, url) {
  const total = report.missing.length + report.res_updates.length + report.pva_updates.length
  let mkdwn = `*TEST-BDORTHO report*:\n`
  if (report.missing.length) {
    mkdwn += `- *${report.missing.length}* new datasets available\n`
  }
  if (report.res_updates.length) {
    mkdwn += `- *${report.res_updates.length}* datasets with better resolution available\n`
  }
  if (report.pva_updates.length) {
    mkdwn += `- *${report.pva_updates.length}* datasets with newer images available\n`
  }
  if (report.out_of_date) {
    const lst = Array.from(new Set(report.out_of_date.map(u => u.dep)))
    mkdwn += `- *${lst.length}* datasets with out of date images on bucket`
  }

  const slack_payload = {
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: mkdwn }
      }
    ]
  }
  slack(slack_payload, url)
  console.log(mkdwn)
}

program
  .description('')
  .requiredOption('-o, --output-dir <directory>', 'output directory where update files will be written')
  .option('-e, --exclude <list>', 'comma separated list of excluded counties', '')
program.parse(process.argv)
const opts = program.opts()

const slack_url = process.env.BDORTHO_SLACK_URL || console.error('BDORTHO_SLACK_URL not defined')
const hostname = process.env.BDORTHO_HOSTNAME || os.hostname()
const output_dir = path.isAbsolute(opts.outputDir)
      ? opts.outputDir
      : path.join(process.cwd(), opts.outputDir)
fs.mkdirSync(output_dir, { recursive: true })

// cleanup output folder first
shell(`rm -f ${output_dir}/*.lst`)

// fetch all available data
scan_bdortho_links().then(whole_ign_db => {
  const ign_db = {}
  // only keep higher res & most up to date pva
  for (const dep in whole_ign_db) {
    for (const dataset of whole_ign_db[dep]) {
      const res = dataset.res
      const pva = dataset.pva

      if (ign_db[dep] &&
          (res > ign_db[dep].res ||
           (res === ign_db[dep].res && pva < ign_db[dep].pva)))
        continue

      ign_db[dep] = { res: res, pva: pva, links: dataset.links }
    }
  }

  // compute and write update files
  const report = {
    missing: [],
    res_updates: [],
    pva_updates: [],
    out_of_date: []
  }

  // fetch what kalisio knows
  const whole_kalisio_db = scan_bdortho_bucket()
  const kalisio_db = {}
  // only keep higher res & most up to date pva
  for (const dep in whole_kalisio_db) {
    const best = { res: 1000, pva: 0 }
    for (const dataset of whole_kalisio_db[dep]) {
      const res = dataset.res
      const pva = dataset.pva

      if (res > best.res || res === best.res && pva < best.pva)
        continue

      best.res = res
      best.pva = pva
    }

    kalisio_db[dep] = best

    // record deprecated data
    for (const dataset of whole_kalisio_db[dep]) {
      if (dataset.res === 500 ||
        (dataset.res === best.res && dataset.pva === best.pva)){
        continue
      }
      report.out_of_date.push({ dep, res: dataset.res, pva: dataset.pva })
    }
  }

  for (const dep in ign_db) {
    const src = ign_db[dep]
    const newres = src.res
    const newpva = src.pva

    let write_update = false
    if (!kalisio_db[dep]) {
      report.missing.push(dep)
      write_update = true
    } else {
      const curres = kalisio_db[dep].res
      const curpva = kalisio_db[dep].pva

      if (newres < curres) {
        report.res_updates.push({ dep, from: curres, to: newres })
        write_update = true
      } else if (newpva > curpva) {
        report.pva_updates.push({ dep, from: curpva, to: newpva })
        write_update = true
      }
    }

    if (write_update) {
      const res = src.res > 100 ? `${src.res / 100}m` : `${src.res}cm`
      const fd = fs.openSync(path.join(output_dir, `${dep}.${res}.${src.pva}.lst`), 'w')
      fs.writeSync(fd, src.links.join('\n'))
      fs.writeSync(fd, '\n')
      fs.closeSync(fd)
    }
  }

  // notify report if anything interesting
  if (report.missing.length || report.res_updates.length || report.pva_updates.length || report.out_of_date.length) {
    slack_report(report, hostname, slack_url)
  }
}).catch((err) => {
  console.error(`Failed fetching links : ${err}`)
})