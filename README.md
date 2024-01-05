# bdortho
A nodejs tool to download and process orthoimagery from the IGN website.
(with docker & kubernetes support)

# master

The master will run the following node scripts:
- `entrypoint.js` - This script is responsible for running the correct script based on the `ROLE` (master/worker) environment variable, and will stop the container when `TTS` is reached.
- - `master_updates.js` - This script is responsible for checking the IGN website for new images.  When new updates are detected, it sends a Slack message to the specified  `BDORTHO_SLACK_URL` (by calling `check_updates.js` ), and then dispatches a job to the worker. 


# worker

The worker will run the following node scripts:
- `entrypoint.js` - This script is responsible for running the correct script based on the `ROLE` (master/worker) environment variable, and will stop the container when `TTS` is reached.
- - `worker_init.js` - This script is responsible for initializing the worker.  By choosing a the first job from the queue, and then calling `worker_process.js` to process the job.
- - - `worker_process.js` - This script is responsible for processing the job.  By downloading, extracting, transforming, and uploading the new orthoimagery to the specified `BDORTHO_BUCKET`  When the job is complete, it will send a Slack message to the specified `BDORTHO_SLACK_URL`, and then the `worker_init.js` will choose the next job from the queue. until the queue is empty.



# Environment Variables

| Variable | Description |default|
| --- | --- | --- |
| `ROLE` | Role of the container (master/worker)| undefined|
| `TIMEZONE` | Timezone to determine the time to stop| Europe/Paris|
| `TTS` | Time to stop in format HH:MM the process| undefined (will run forever)|
| `BDORTHO_SLACK_URL` | Slack webhook url| undefined (will not send slack messages)|
| `BDORTHO_BUCKET` | location of the bucket (can be a host folder or a s3 bucket)| undefined|
| `JOBS` | number of transformation jobs to run in parallel (for the workers)| 1|



(TODO: add rclone config file and access keys for s3 for docker)

# requirements
- p7zip 
- nodejs 
- npm 
- rclone 
- curl 
- findutils

# limitations
- Running to many `JOBS` without enough memory will cause the current update process to fail.
- (possible solution : estimate memory available and limit the number of jobs based on the available memory)
