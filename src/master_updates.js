const fs = require('fs')
const path = require('path')
const { exec,slack } = require('./bdortho');
const { program } = require('commander');
const { env } = require('process');


program
  .description('Init container process for kubernetes')
    .option('-tmp, --tmp-dir <directory>', 'the ouput folder where to write processing results', 'tmp')
    .option('-v, --volumes <volume>', 'directory where the volumes for the pod are mounted', 'volumes')
program.parse(process.argv)
const opts = program.opts()

const DEP_TO_EXCLUDE = env.DEP_TO_EXCLUDE || ''

fs.mkdirSync(opts.tmpDir, { recursive: true })


// Step 1: We if the workers have finished their tasks (if their volume is empty)
const workers = fs.readdirSync(opts.volumes)
workers.forEach(worker =>{
    if (fs.readdirSync(path.join(opts.volumes, worker)).length > 0){
        console.log(`The worker ${worker} has not finished its tasks`)
        process.exit(1)
    }
}
)

// Step 2: check wich links need to be updated
exec('node', [ 'src/check_updates', '-o', path.join(opts.tmpDir, 'update_links'), '-e', DEP_TO_EXCLUDE ])

// Step 3: We create a "todo" dir for each worker
nb_tasks_per_worker={}
workers.forEach(worker =>{
    nb_tasks_per_worker[worker] = 0
    fs.mkdirSync(path.join(opts.volumes, worker, 'todo'), { recursive: true })

})

// Step 4 :We dispatch the tasks to the workers by moving the .lst files from the "update_links" dir to the "todo" dir of each worker in function of the number of tasks they already had
//      We remove the .lst files from the "update_links" dir
const update_links = fs.readdirSync(path.join(opts.tmpDir, 'update_links'))
console.log(`There are ${update_links.length} links to update`)
update_links.forEach(link =>{
    // We get the worker with the least tasks
    const worker = Object.keys(nb_tasks_per_worker).reduce((a, b) => nb_tasks_per_worker[a] < nb_tasks_per_worker[b] ? a : b);
    // We move the .lst file from the "update_links" dir to the "todo" dir of the worker
    // fs.renameSync(path.join(opts.tmpDir, 'update_links', link), path.join(opts.volumes, worker, 'todo', link))
    exec('mv', [path.join(opts.tmpDir, 'update_links', link), path.join(opts.volumes, worker, 'todo', link)])
    nb_tasks_per_worker[worker] += 1
})


console.log('All tasks were dispatched to workers')
// Remove the "tmp" dir 
exec('rm', ['-rf', opts.tmpDir])
console.log(nb_tasks_per_worker)

