const {execAsync,exec} = require('./bdortho');
const { DateTime } = require("luxon");
const { env } = require('process');


const ROLE=env.ROLE ||  console.error("ROLE not defined, exiting...") || process.exit(1)
const tmpdir = env.TMPDIR || "tmp"
const volumes = env.VOLUMES || "volumes"
const TTS = env.TTS || console.error("TTS not defined, process will run indefinitely")
const TIMEZONE = env.TIMEZONE || "Europe/Paris"
const jobs = env.JOBS || 1


console.log("Starting process with args:")
console.log("ROLE:", ROLE)
console.log("tmpdir:", tmpdir)
console.log("volumes:", volumes)
console.log("TTS:", TTS)
console.log("TIMEZONE:", TIMEZONE)
console.log("jobs:", jobs)

// Calculation of the time remaining before the stop time (TTS) its format is a string "HH:MM"
function get_time_to_stop(TTS, TIMEZONE) {
    try {
      // Get current date and time in the specified TIMEZONE
      const now = DateTime.local().setZone(TIMEZONE);
  
      // Get date and time for TTS in the specified TIMEZONE
      let tts = DateTime.fromFormat(TTS, 'HH:mm', { zone: TIMEZONE });
  
      // If tts is before now, add one day
      if (tts < now) {
        tts = tts.plus({ days: 1 });
      }
      // Calculate the difference in seconds between now and tts
      const diffInSeconds = tts.diff(now, 'seconds').seconds;
  
      return diffInSeconds;
    } catch (error) {
      console.error("Error while converting date :", error.message);
      return null;
    }
  }

function stop () {
    console.log("Time to stop, exiting...")
    // W
    if (ROLE=="master"){
        exec('pkill', ['-f', 'master_updates.js'])
    }
    else if (ROLE=="worker"){
        exec('pkill', ['-15','-f', 'worker_init.js'])
        exec('pkill', ['-15','-f', 'worker_process.js'])
    }

    process.exit(0)
}
console.log("Process will stop in", get_time_to_stop(TTS, TIMEZONE)/60, "minutes")

process.on('SIGTERM', stop);

if (env.TTS){
    setTimeout(stop, get_time_to_stop(TTS, TIMEZONE)*1000)
    const interval=setInterval(() => {
        console.log("Process will stop in", get_time_to_stop(TTS, TIMEZONE)/60, "minutes")
    }, 1000*60*5)
    
}






async function main(){
    if (ROLE=="master"){
        try{
            await execAsync('node', ['src/master_updates.js', '-tmp', tmpdir, '-v', volumes])
            if (env.TTS){
                clearInterval(interval)
            }
            process.exit(0)
        }
        catch(e){
            console.error(e)
        }
    }
    else if (ROLE=="worker"){
        try{
            await execAsync('node', ['src/worker_init.js', '-v', volumes, '-j', jobs || 1])
            if (env.TTS){
                clearInterval(interval)
            }
            process.exit(0)
            
            
        }
        catch(e){
            console.error(e)
        }
    }
    else{
        console.error("ROLE not defined, exiting...")
        process.exit(1)
    }
}

main()