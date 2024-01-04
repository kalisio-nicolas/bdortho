const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const { shell,exec, exec_scrap, exec_bg,execAsync, parallel_exec,BDORTHO_BUCKET } = require('./bdortho');
const DownloadManager = require('./DownloadManager'); 

program
  .description('Process images from the given archive links.')
  .requiredOption('-l, --link <link>', 'the input file containing download links to process')
  .requiredOption('-w, --work-dir <directory>', 'the output folder where to write processing results')
  .option('-k, --keep-work-dir', 'define to keep work folder at the end of processing')
  .requiredOption('-j, --jobs <num>', 'number of parallel jobs to run', 1);

program.parse(process.argv);
const opts = program.opts();


process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: exiting');
  exec('pkill', ['-9','-f', 'gdal'])
  exec('pkill', ['-9','-f', '7zr'])
  exec('pkill', ['-9','-f', 'rclone'])
  process.exit(0);
});


// Utility function to create a directory if it does not exist
const createDirectory = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const current_link = path.isAbsolute(opts.link)
      ? opts.link
      : path.join(process.cwd(), opts.link)


const work_dir = path.isAbsolute(opts.workDir)
  ? opts.workDir
  : path.join(process.cwd(), opts.workDir);

const keep_work_dir = opts.keepWorkDir;

createDirectory(work_dir);  // create work_dir if it does not exist

const tmp_dir = path.join(work_dir, 'tmp');
const dl_dir = path.join(work_dir, 'dl');
const res_dir = path.join(work_dir, 'results');


createDirectory(tmp_dir);
createDirectory(dl_dir);
createDirectory(res_dir);


console.log('Now working on', current_link);


const items = path.basename(current_link, '.lst').split('.');
const dept = items[0];
const reso = items[1];
const pva = items[2];
const hdr = `${dept}.${reso}.${pva}`;




console.log(`${hdr}: results will be stored in ${res_dir}\n`);

async function download() {
    shell(`rm -fR ${dl_dir}/*`)

    if (fs.existsSync(path.join(tmp_dir, 'dl_done'))) {
      console.log('Download already done, skipping');
      return;
    }

    // We need to get the list of links from the current_link file
    const links = fs.readFileSync(current_link, 'utf8').split('\n').filter(Boolean)


    const downloadManagers = links.map((link) => new DownloadManager(link, dl_dir, tmp_dir));
    const downloadPromises = downloadManagers.map((downloadManager) => downloadManager.startDownload());

    // Check download status every second
    const interval = setInterval(() => {
      DownloadManager.checkDownloadsStatus(downloadManagers);
      // If all downloads are complete, stop the interval
      if (downloadManagers.every((downloadManager) => downloadManager.isComplete())) {
        clearInterval(interval);
      }
    }, 120000); 
// 120000 = 2 minutes
    try {
      await Promise.all(downloadPromises)
      console.log('All files downloaded successfully');
      exec('touch', [path.join(tmp_dir, 'dl_done')]);
    }
    catch (err) {
      console.error('Download failed', err);
      if (!keep_work_dir) {
        console.log(`\n${hdr}: deleting workdir in [download]\n`)
        shell(`rm -fR ${work_dir}`)
      }
      process.exit(133)
      
    }
;
}

async function extract() {
  console.log('current memory usage: ', process.memoryUsage().rss / 1024 / 1024, 'MB');
    if (fs.existsSync(path.join(tmp_dir, 'extract_done'))) {
      console.log('Extraction already done, skipping');
      return;
    }

    const archives = exec_scrap('find', [tmp_dir, '-regex', '.*7z\\(\\.001\\)?'])["stdout"].split('\n');

    // Check if there is any archive to extract
    if (archives.length === 0 || (archives.length === 1 && archives[0] === '')) {
      return;
    }

    console.log(`\n${hdr}: extracting data from '${archives[0]}'\n`);

    // Extract archive
    const status = exec('7zr', ['x', '-y', '-bsp1', archives[0]], { cwd: tmp_dir, exit_if_fails: false })["status"];
    if (status !== 0) {
      console.log("Extraction failed");
      if (!keep_work_dir) {
        console.log(`\n${hdr}: deleting workdir in [extract]\n`)
        shell(`rm -fR ${work_dir}`)
      }
      process.exit(134);
    }

    // Flag extraction done
    exec('touch', [path.join(tmp_dir, 'extract_done')]);
}

async function transform() {
    let images = exec_scrap('find', [tmp_dir, '-name', '*.jp2'])["stdout"].split('\n');

    if (images.length === 0 || (images.length === 1 && images[0] === '')) {
      // Try again and search for *.tif
      images = exec_scrap('find', [tmp_dir, '-name', '*.tif'])["stdout"].split('\n');

      if (images.length === 0 || (images.length === 1 && images[0] === '')) {
        return;
      }
    }

    console.log(`\n${hdr}: converting to COG \n`);

    const tasklist = images
      .filter((image) => image !== '')
      .map((image, i) => {
        const ext = path.extname(image);
        const basefile = path.basename(image, ext);
        const outfile = path.join(res_dir, basefile + '.tif');
        const logfile = path.join(tmp_dir, basefile + '.log');

        return {
          job: () => {
            console.log(`gdal_translate ${path.basename(image)} : ${i + 1}/${images.length - 1}`);
            return exec_bg('gdal_translate', ['-of', 'COG', '-co', 'COMPRESS=JPEG', image, outfile], logfile, { cwd: tmp_dir, exit_if_fails: false });
          },
          success: () => {
            exec('rm', [image, logfile]);
          },
          fail: () => {
            console.log(`Transform failed for ${image}`);
            exec('pkill', ['-9','-f', 'gdal'])
            process.exit(135);
          },
        };
      });

    try {
      await parallel_exec(tasklist, opts.jobs);
    }
    catch (err) {
      console.error('Transform failed', err);
    }
}

async function load_to_bucket() {
    // upload to s3 bucket
    const bucket = `${BDORTHO_BUCKET}/D${dept}.${reso}.${pva}`
    console.log(`\n${hdr}: syncing to ${bucket}\n`)
    try {
      exec('rclone', ['-v', 'sync', res_dir, bucket])
    }
    catch (err) {
      console.error('Upload failed', err);
      if (!keep_work_dir) {
        console.log(`\n${hdr}: deleting workdir in [upload]\n`)
        shell(`rm -fR ${work_dir}`)
      }
      process.exit(136)
    }


    // all good, delete  the workdir
    if (!keep_work_dir) {
      console.log(`\n${hdr}: deleting workdir in [success]\n`)
      shell(`rm -fR ${work_dir}`)
    }
}




async function main() {
  console.log("Start download at ",  new Date().toLocaleString())
  before = new Date().getTime();
  await download()
  after = new Date().getTime();
  console.log("Download done at ", new Date().toLocaleString(), "and took ", (after-before)/1000/60, "minutes")
  console.log("Start extract at ",  new Date().toLocaleString())
  before = new Date().getTime();
  await extract()
  after = new Date().getTime();
  console.log("Extract done at ", new Date().toLocaleString(), "and took ", (after-before)/1000/60, "minutes")
  console.log("Start transform at ",  new Date().toLocaleString())
  before = new Date().getTime();
  await transform()
  after = new Date().getTime();
  console.log("Transform done at ", new Date().toLocaleString(), "and took ", (after-before)/1000/60, "minutes")
  console.log("Start upload at ",  new Date().toLocaleString())
  before = new Date().getTime();
  await load_to_bucket() 
  after = new Date().getTime();
  console.log("Upload done at ", new Date().toLocaleString(), "and took ", (after-before)/1000/60, "minutes")
  console.log('All done');
}

main();