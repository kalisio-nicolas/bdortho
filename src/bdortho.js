const url = require('url')
const os = require('os')
const https = require('https')
const child_process = require('child_process')
const path = require('path')
const ftp = require('basic-ftp')
const { env } = require('process');

// const BDORTHO_BUCKET = 'scw:kalisio-map-data/IGN/BDORTHO'
// const BDORTHO_BUCKET = 'ovh:kargo/data/IGN/BDORTHO'
// const BDORTHO_BUCKET = './bucket'
const BDORTHO_BUCKET = env.BDORTHO_BUCKET  || console.error("BUCKET not defined, exiting...") || process.exit(1)

function _shell(cl, opts) {
  opts.cwd = opts.cwd || process.cwd()
  opts.env = opts.env || process.env
  console.log(`'${cl}' in '${opts.cwd}'`)
  try {
    stdout = child_process.execSync(cl, opts)
  } catch(e) {
    console.error(e)
    process.exit(1)
  }

  return stdout ? stdout.toString() : ''
}

function _exec(exe, args, opts, { exit_if_fails = true } = {}) {
  opts.cwd = opts.cwd || process.cwd()
  opts.env = opts.env || process.env
  exit_if_fails = opts.exit_if_fails
  console.log(`'${exe} ${args.join(' ')}' in '${opts.cwd}'`)
  const p = child_process.spawnSync(exe, args, opts)
  if (p.status != 0) {
    if (p.error){
      console.error(p.error)
    }
    if (exit_if_fails) {
      process.exit(1)
    }
  }

  return { status: p.status, stdout: p.stdout ? p.stdout.toString() : '' }
}


function execAsync(exe, args, opts) {
  opts = opts || {};
  opts.cwd = opts.cwd || process.cwd();
  opts.env = opts.env || process.env;

  console.log(`'${exe} ${args.join(' ')}' in '${opts.cwd}'`);

  return new Promise((resolve, reject) => {
    const child = child_process.spawn(exe, args, {
      ...opts,
      stdio: 'inherit', // Redirect stdout and stderr to the console
    });

    // Handle process exit
    child.on('close', (code) => {
      resolve(code)
    });

    // Handle errors
    child.on('error', (err) => {
      reject(err);
    });
  });
}





function shell(cl, { cwd = null, env = null } = {}) {
  const opts = {
    cwd: cwd,
    stdio: 'inherit',
    env: env
  }
  return _shell(cl, opts)
}

function shell_scrap(cl, { cwd = null, env = null } = {}) {
  const opts = {
    cwd: cwd,
    stdio: 'pipe',
    env: env
  }
  return _shell(cl, opts)
}

function exec(exe, args, { cwd = null, env = null , exit_if_fails = true} = {}) {
  const opts = {
    cwd: cwd,
    stdio: 'inherit',
    env: env,
    exit_if_fails : exit_if_fails
  }
  return _exec(exe, args, opts)
}

function exec_scrap(exe, args, { cwd = null, env = null } = {}) {
  const opts = {
    cwd: cwd,
    stdio: 'pipe',
    env: env
  }
  return _exec(exe, args, opts)
}

function exec_bg(exe, args, log_file, { cwd = null, env = null, exit_if_fails = true } = {}) {
  const opts = {
    cwd: cwd,
    stdio: 'inherit',
    env: env
  }
  const cl = `${exe} ${args.join(' ')} >> ${log_file} 2>&1`
  console.log(`'${cl}' in '${opts.cwd}'`)
  return new Promise((resolve, reject) => {
    child_process.exec(cl, opts, (error, stdout, stderr) => {
      if (error !== null) {
        console.error(stderr)
        if (exit_if_fails) {
          process.exit(1)
        } else {
          reject()
        }
      }

      resolve()
    })
  })
}








function slack(payload, url) {
  const ret = child_process.spawnSync('curl', [
    '-X', 'POST',
    '-H', 'Content-type: application/json',
    '--data', JSON.stringify(payload),
    url
  ])
  if (ret.status != 0)
    console.error("Error while sending slack message")
}



async function scan_bdortho_links() {
  // we're only interested in those links
  const filter_regex = /(BDORTHO_2-0_RVB|BDORTHO-5M_2-0_TIFF|ORTHOHR_1-0_RVB)/

  // fetch links from geoservices url
  const url_promise = new Promise((resolve, reject) => {
    const url = "https://geoservices.ign.fr/bdortho"
    console.log(`Scrapping links from ${url}`)
    const req = https.get(url, (res) => {
      const { statusCode } = res
      let error
      if (statusCode !== 200) {
        error = new Error(`Request failed, status code is ${statusCode}`)
      }
      if (error) {
        res.resume()
        reject(error)
      }
 
      res.setEncoding('utf8')

      let content = ''
      res.on('data', (chunk) => { content += chunk })
      res.on('end', () => {
        const links = []
        const href_regex = /<a href="(.*)">/g
        for (const match of content.matchAll(href_regex)) {
          try {
            const link = new URL(match[1])
            const m = link.pathname.match(filter_regex)
            if (m)
              links.push(match[1])
          } catch(err) {
            // console.log(match[1])
          }
        }
        resolve(links)
      })
    }).on('error', (err) => {
      reject(err)
    })
  })

  // also scan ign ftp
  // robin: this does not work anymore (01.2023)
  // all links seem to be present on geoservices url
  /*
  const ftp_promise = new Promise(async (resolve, reject) => {
    const links = []
    const ftpc = new ftp.Client()
    // ftpc.ftp.verbose = true
    // ftpc.prepareTransfer = ftp.enterPassiveModeIPv4

    const credentials = [
      { host: 'ftp3.ign.fr', user: 'ORTHO_HR_ext', password: 'Ithacah6ophai2vo' },
      { host: 'ftp3.ign.fr', user: 'ORTHO_HR_NL_ext', password: 'puiweep2Boh3ohsh' }
    ]

    for (const cred of credentials) {
      console.log(`Scrapping links from ${cred.user}@${cred.host}`)
      try {
        await ftpc.access(cred)
        for (const entry of await ftpc.list()) {
          if (entry.type !== ftp.FileType.File)
            continue

          const m = entry.name.match(filter_regex)
          if (m)
            links.push(`ftp://${cred.user}:${cred.password}@${cred.host}/${entry.name}`)
        }
        ftpc.close()
      } catch(err) {
        ftpc.close()
        reject(err)
      }
    }

    resolve(links)
  })
  */
  const all_links = (await Promise.all([url_promise /*, ftp_promise */])).flat()

  // merge links, when two point at the same file, prefer ftp links
  // map is [ basename -> url ]
  const sorted_links = new Map()
  all_links.forEach(new_link => {
    const new_url = new URL(new_link)
    const basename = path.basename(new_url.pathname)
    if (!sorted_links.has(basename)) {
      sorted_links.set(basename, new_link)
    } else {
      const known_link = sorted_links.get(basename)
      if (known_link !== new_link) {
        const known_url = new URL(known_link)
        if (known_url.protocol === 'ftp:') {
          console.log(`Found duplicate link for ${basename}, keeping ${known_link} instead of ${new_link}`)
        } else {
          console.log(`Found duplicate link for ${basename}, replacing ${known_link} with ${new_link}`)
          sorted_links.set(basename, new_link)
        }
      }
    }
  })

  // now process links
  const db = {}
  const regex1 = /(BDORTHO|ORTHOHR).*-([0-9]M[0-9]+).*_D([0-9AB]+)_([0-9]+)/
  const regex2 = /BDORTHO-([0-9])M_2-0_TIFF_.*_D([0-9AB]+)_([0-9]+)/
  for (const [ basename, link ] of sorted_links ) {
    let dep, res, pva

    const m1 = link.match(regex1)
    if (m1) {
      dep = m1[3][0] === '0' ? m1[3].substring(1) : m1[3]
      res = parseInt(m1[2][0]) * 100 + parseInt(m1[2].substring(2))
      pva = parseInt(m1[4])
    } else {
      const m2 = link.match(regex2)
      if (!m2)
        continue

      dep = m2[2][0] === '0' ? m2[2].substring(1) : m2[2]
      res = parseInt(m2[1]) * 100
      pva = parseInt(m2[3])
    }

    if (!db[dep]) db[dep] = []
    let idx = -1
    // search for collection with matching res + pva
    for (let i = 0; i < db[dep].length && idx === -1; ++i) {
      if (db[dep][i].res === res && db[dep][i].pva === pva)
        idx = i
    }
    if (idx !== -1) {
      db[dep][idx].links.push(link)
    } else {
      db[dep].push({ res: res, pva: pva, links: [ link ] })
    }
  }

  return db
}

function scan_bdortho_bucket() {
  const db = {}
  const directories = shell_scrap(`rclone lsd ${BDORTHO_BUCKET} | awk '{print $5}'`).split('\n')
  const regex = /D([0-9AB]+)\.([0-9]+(m|cm))\.([0-9]+)/
  for (let i = 0; i < directories.length; ++i) {
    const directory = directories[i]
    const match = directory.match(regex)
    if (!match) continue

    const dep = match[1]
    const res = parseInt(match[2]) * (match[3] === 'm' ? 100 : 1)
    const pva = parseInt(match[4])

    if (!db[dep]) db[dep] = []
    db[dep].push({ res: res, pva: pva, path: directory })
  }

  return db
}

async function parallel_exec(tasklist, concurrency) {
  const pending = Array.from({ length: concurrency }, (v, k) => null)
  const tickets = Array.from({ length: concurrency }, (v, k) => k)
  for (const task of tasklist) {
    const job = task.job()
    const index = tickets.pop()
    job.then(() => {
      // job done, make room for new job
      tickets.push(index)
      task.success()
    }).catch(() => {
      // job failed, make room for new job
      tickets.push(index)
      task.fail()
    })
    pending[index] = job
    if (tickets.length == 0) {
      try {
        await Promise.race(pending)
      } catch(err) {
        // some job failed, keep on
      }
    }
  }

  await Promise.all(pending)
}

exports.shell = shell
exports.shell_scrap = shell_scrap
exports.exec = exec
exports.exec_scrap = exec_scrap
exports.exec_bg = exec_bg
exports.execAsync = execAsync
exports.parallel_exec = parallel_exec
exports.slack = slack
exports.scan_bdortho_links = scan_bdortho_links
exports.scan_bdortho_bucket = scan_bdortho_bucket

exports.BDORTHO_BUCKET = BDORTHO_BUCKET
