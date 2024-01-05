const fs = require('fs')
const os = require('os')
const path = require('path')
const {exec,execAsync,slack,shell } = require('./bdortho');
const { program } = require('commander');
const { env } = require('process');

function slack_log(message, color, url) {
    
    const slack_payload = { }
    if (color) {
      slack_payload.attachments = [
        {
          color,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: message }
            }
          ]
        }
      ]
    } else {
      slack_payload.blocks = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: message }
        }
      ]
    }
  
    slack(slack_payload, url)
    console.log(message)
  }





program
  .description('Init container process for kubernetes')
    .option('-v, --volume <VOLUME>', 'directory where the volume for the pod is mounted', 'volume')
    .option('-j, --jobs <JOBS>', 'number of jobs to run in parallel', '1')

program.parse(process.argv)
const opts = program.opts()




var current_link = null
const ERR_CODES = {133: "Download failed", 134: "Extract failed", 135: "Transform failed", 136: "Upload failed"}
const hostname= env.HOSTNAME || os.hostname()
const slack_url = process.env.BDORTHO_SLACK_URL || console.error("BDORTHO_SLACK_URL not defined")


function add_to_done(link){
    fs.renameSync(link, path.join(VOLUME, path.basename(link).replace('.lst', '.done')))
}

function add_to_failed(link){
    fs.renameSync(link, path.join(VOLUME, path.basename(link).replace('.lst', '.failed')))
}



function get_num_total(){
    total=0
    if (fs.existsSync(path.join(VOLUME, 'todo'))){
      total+=fs.readdirSync(path.join(VOLUME, 'todo')).filter(file => file.endsWith('.lst')).length
    }
    if (fs.existsSync(path.join(VOLUME, 'workdir'))){
      total+=fs.readdirSync(path.join(VOLUME, 'workdir')).filter(file => file.endsWith('.lst')).length
    }
    total+=get_num_done()
    total+=get_num_failed()
    return total
  }

function get_num_done(){

    return fs.readdirSync(VOLUME).filter(file => file.endsWith('.done')).length
}

function get_num_failed(){
    
    return fs.readdirSync(VOLUME).filter(file => file.endsWith('.failed')).length
}


process.on('SIGTERM', () => {

    console.log("Time to stop, exiting...")
    console.log("Failed links:", get_num_failed())
    console.log("Done links:", get_num_done())
    console.log("Current link:", current_link)
    slack_log(`*TEST_BDORTHO*: interrupting work on *${hostname}*, *[${get_num_total()}/${current_link ? 1 : 0}/${get_num_done()}/${get_num_failed()}]* (total/pending/success/failed).`, '#d15c21', slack_url)

    // We kill the worker process
    exec('pkill', ['-f', 'worker_process.js'])
    process.exit(0)
});





const VOLUME = env.VOLUME || opts.volume



// Get the next link to process from the todo folder, null if there is no more links to process
function get_new_link(){
    let link = null
    // If we have a workdir folder and there is a .lst file in it we take it and resume work
    if (fs.existsSync(path.join(VOLUME, 'workdir')) && fs.readdirSync(path.join(VOLUME, 'workdir')).filter(file => file.endsWith('.lst')).length > 0) {
        link = path.join(VOLUME, 'workdir', fs.readdirSync(path.join(VOLUME, 'workdir')).filter(file => file.endsWith('.lst'))[0])
        console.log("Worker was already running, resuming work on", path.basename(link))
    }
    // If we have a todo folder and there is a file in it we take it and move it to the workdir
    else if (fs.existsSync(path.join(VOLUME, 'todo')) && fs.readdirSync(path.join(VOLUME, 'todo')).length > 0) {

        link = path.join(VOLUME, 'todo', fs.readdirSync(path.join(VOLUME, 'todo'))[0])
        // In case the workdir folder exists but without a .lst file we delete it and recreate it, we should never get here but just in case
        if (fs.existsSync(path.join(VOLUME, 'workdir'))) {
            fs.rmdirSync(path.join(VOLUME, 'workdir'), { recursive: true })
        }
        // We create the workdir folder and move the file from the todo folder to the workdir folder
        fs.mkdirSync(path.join(VOLUME, 'workdir'))
        fs.renameSync(link, path.join(VOLUME, 'workdir', path.basename(link)))
        link = path.join(VOLUME, 'workdir', path.basename(link))
    }
    return link
}





async function main(){
    
    current_link=get_new_link()
    if (current_link){
        console.log("Starting worker process...")
        slack_log(`*TEST_BDORTHO*: resuming work on *${hostname}*, *[${get_num_total()}/${current_link ? 1 : 0}/${get_num_done()}/${get_num_failed()}]* (total/pending/success/failed).`, '#d15c21', slack_url)
    }

    while(current_link!=null){
        console.log("Now working on", current_link)
        try {
            code = await execAsync('node', ['src/worker_process.js', '-l', current_link, '-w', path.join(VOLUME, 'workdir'), '-j', opts.jobs,'-k'], { exit_if_fails: false })
            // code : 0 Everything went well
            // code : 133 Download failed
            // code : 134 Extract failed
            // code : 135 Transform failed
            // code : 136 Upload failed
            if (code == 0) {
                console.log("Process for link", path.basename(current_link)," exited successfully")
                add_to_done(current_link)
                slack_log(`*TEST_BDORTHO*: *${path.basename(current_link)}* done on *${hostname}* [${get_num_done()}/${get_num_total()}] (success/total).`, '#2eb886', slack_url)
            }
            else{
                console.log("Process for link", path.basename(current_link)," exited with error: ", ERR_CODES[code] || code )
                add_to_failed(current_link) 
                slack_log(`*TEST_BDORTHO*: *${path.basename(current_link)}* failed on *${hostname}* with error: ${ERR_CODES[code] || code}, *[${get_num_total()}/${get_num_done()}/${get_num_failed()}]* (total/success/failed).`, '#d50200', slack_url)
            }
        }
        catch (e) {
            console.log("Process exited with an unknown error", e)
            add_to_failed(current_link)
            slack_log(`*TEST_BDORTHO*: *${path.basename(current_link)}* failed on *${hostname}* *[${get_num_total()}/${get_num_done()}/${get_num_failed()}]* (total/success/failed).`, '#d50200', slack_url)
        }
        current_link=get_new_link()
    }
    console.log("No more links to process, exiting...")
    if (get_num_done()>0 || get_num_failed()>0){
        slack_log(`*BDORTHO*: *${hostname}* finished all tasks *[${get_num_total()}/${get_num_done()}/${get_num_failed()}]* (total/success/failed).`, '#2eb886', slack_url)
        // We delete everything in the volume folder
        shell(`rm -fR ${VOLUME}/*`)

    }
    process.exit(0)
    
}

main()