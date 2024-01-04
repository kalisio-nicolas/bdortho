const { program } = require('commander')
const fs = require('fs')
const path = require('path')
const { BDORTHO_BUCKET, exec, exec_scrap, shell } = require('./bdortho')

program
  .description('Build tile index for images available on the bucket.')
  .requiredOption('-w, --work-dir <dir>', 'output directory where to write tile indexes')
  .option('-h, --hires', 'build highres tile index (bdortho/orthohr 50cm, 20cm, 15cm)')
  .option('-l, --lores', 'build lowres tile index (bdortho 5m)')
program.parse(process.argv)
const opts = program.opts()

// we assume the following pattern for images :
// folder/{num_dept}-{pva}-{x}-{y}-{proj}-{res}-{?}.tif

const dohr = opts.hires
const do5m = opts.lores

const work_dir = path.isAbsolute(opts.workDir)
      ? opts.workDir
      : path.join(process.cwd(), opts.workDir)

fs.mkdirSync(work_dir, { recursive: true })

// list available tiles
const items = BDORTHO_BUCKET.split(':')
const remote = items[0]
const bucket = items[1]
const ign_bucket = `${remote}:${path.dirname(bucket)}`
const tiflist = path.join(work_dir, 'tiflist.lst')
// use a temporary file since there's a lot of tiles and shell pipes may run out of memory
shell(`rclone ls ${BDORTHO_BUCKET} | grep -e "tif$" | awk '{print $2}' > ${tiflist}`)
const all_files = fs.readFileSync(tiflist, 'utf8').split('\n')

//               dep   -  pva   -   x    -   y   ...  res
const regex = /[0-9AB]+-([0-9]+)-([0-9]+)-([0-9]+).*([0-9])(m|M[0-9]+)/

// map associating for each 5m tile the date of images (we only keep the most up to date)
// each map entry is { pva: pva, file: tile_file }
// keys are string resulting from concatenating x and y tile coordinates
const tiles_5m = new Map()
// map associating for each tile the best resolution we have and the corresponding file (we only keep the best resolution)
// each map entry is { reso: tile_resolution, file: tile_file }
// keys are string resulting from concatenating x and y tile coordinates
const tiles_hr = new Map()

for (const file of all_files) {
  if (file === '')
    continue

  const m = file.match(regex)
  if (!m)
    continue

  const pva = parseInt(m[1])
  const x = parseInt(m[2])
  const y = parseInt(m[3])
  const cm = m[5].substring(1)
  const res = (parseInt(m[4]) * 100) + (cm.length ? parseInt(cm) : 0)

  if (res === 500) {
    // for 5m tiles, we keep the most up to date wrt date of images
    const key = `${x}-${y}`
    const t = tiles_5m.get(key)
    if (t && t.pva > pva)
      // this tile is already covered by a higher res file
      continue

    // this is the most up to date image
    tiles_5m.set(key, { pva, file })
  } else {
    if (res == 50 || res == 20) {
      // insert tiles at the 15cm level
      for (let dx = 0; dx < 100; dx += 25) {
        for (let dy = 0; dy < 100; dy += 25) {
          const key = `${x*100+dx}-${y*100+dy}`
          const t = tiles_hr.get(key)
          if (t && (t.res < res || (t.res === res && t.pva > pva)))
            // this tile is already covered by a higher res file
            // or by a newer pva at same res
            continue

          // this is the best resolution we have for this tile
          tiles_hr.set(key, { res, pva, file })
        }
      }
    } else {
      const key = `${x}-${y}`
      const t = tiles_hr.get(key)
      if (t && ((t.res < res) || (t.res === res && t.pva > pva)))
        // this tile is already covered by a higher res file
        // or by a newer pva at same res
        continue

      // this is the best resolution we have for this tile
      tiles_hr.set(key, { res, pva, file })
    }
  }
}

// scrap rclone config to find out required env vars for gdal vsis3 access
// AWS_S3_ENDPOINT
// AWS_REGION
// AWS_SECRET_ACCESS_KEY
// AWS_ACCESS_KEY_ID

const rclone_conf = JSON.parse(exec_scrap('rclone', [ 'config', 'dump' ]))
const remote_conf = rclone_conf[remote]

const gdal_env = Object.assign({}, process.env)
gdal_env.AWS_S3_ENDPOINT = remote_conf.endpoint
gdal_env.AWS_REGION = remote_conf.region
gdal_env.AWS_SECRET_ACCESS_KEY = remote_conf.secret_access_key
gdal_env.AWS_ACCESS_KEY_ID = remote_conf.access_key_id

const tile5m_list = path.join(work_dir, 'ign_bdortho5m.tiles')
const tilehr_list = path.join(work_dir, 'ign_highres.tiles')


if (do5m) {
  // write 5m tile list
  const content = Array.from(tiles_5m.values()).map(t => `/vsis3/${bucket}/${t.file}`).join('\n')
  fs.writeFileSync(tile5m_list, content)

  // use gdal to generate tile index
  // tile index is created in 4326 and individual tile projection are stored in 'tile_srs' property
  // (cf. mapserver TILESRS property)
  exec('gdaltindex',
       [ '-tileindex', 'location'
       , '-t_srs', 'EPSG:4326'
       , '-src_srs_name', 'tile_srs'
       , '-src_srs_format', 'EPSG'
       , 'ign_bdortho5m.shp', '--optfile', tile5m_list ], { cwd: work_dir, env: gdal_env })

  const exts = [ 'shp', 'shx', 'dbf', 'prj' ]
  for (const e of exts) {
    exec('rclone', [ 'delete', `${ign_bucket}/ign_bdortho5m.${e}` ])
    exec('rclone', [ 'copy', `ign_bdortho5m.${e}`, `${ign_bucket}` ], { cwd: work_dir })
  }
}

if (dohr) {
  // write high res tile list
  const tiles15 = []
  // make sure 50 and 20 cm tiles are only written once
  const tiles = new Set()
  for (const t of tiles_hr.values()) {
    if (t.res === 15) tiles15.push(t.file)
    else tiles.add(t.file)
  }

  // put 50 and 20 cm tiles first
  const content = Array.from(tiles.values()).map(f => `/vsis3/${bucket}/${f}`).join('\n') + '\n' + tiles15.map(f => `/vsis3/${bucket}/${f}`).join('\n')
  fs.writeFileSync(tilehr_list, content)

  // use gdal to generate tile index
  // tile index is created in 4326 and individual tile projection are stored in 'tile_srs' property
  // (cf. mapserver TILESRS property)
  exec('gdaltindex',
       [ '-tileindex', 'location'
       , '-t_srs', 'EPSG:4326'
       , '-src_srs_name', 'tile_srs'
       , '-src_srs_format', 'EPSG'
       , 'ign_highres.shp', '--optfile', tilehr_list ], { cwd: work_dir, env: gdal_env })

  const exts = [ 'shp', 'shx', 'dbf', 'prj' ]
  for (const e of exts) {
    exec('rclone', [ 'delete', `${ign_bucket}/ign_highres.${e}` ])
    exec('rclone', [ 'copy', `ign_highres.${e}`, `${ign_bucket}` ], { cwd: work_dir })
  }
}
