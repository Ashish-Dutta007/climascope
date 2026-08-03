#!/usr/bin/env bash
# Submit from the app git root with: sbatch build_hillshade.slurm
#
# Measured national runs are primarily shared-storage I/O limited (about 67 GB
# peak RSS), so a normal medium allocation is more appropriate than himem. The
# intermediates live on BeeGFS scratch; only validated final products are
# atomically published into app/data by the build scripts.
#SBATCH --job-name=climascope-hillshade
#SBATCH --account=cropdiv-acc
#SBATCH --partition=medium
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=96G
#SBATCH --time=12:00:00
#SBATCH --chdir=/mnt/shared/docker/climascope/app
#SBATCH --output=data/hillshade-build-%j.log
#SBATCH --error=data/hillshade-build-%j.log

set -euo pipefail

export THREADS="${SLURM_CPUS_PER_TASK}"
export GDAL_CACHEMAX_MB="${GDAL_CACHEMAX_MB:-8192}"
export WARP_MEMORY_MB="${WARP_MEMORY_MB:-8192}"
export HILLSHADE_WORK_DIR="${HILLSHADE_WORK_DIR:-${SCRATCH:-/mnt/shared/scratch/$USER}/climascope_hillshade}"

mkdir -p "$HILLSHADE_WORK_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] SLURM job ${SLURM_JOB_ID} on $(hostname): ${THREADS} CPUs, ${SLURM_MEM_PER_NODE:-unknown} MB"
srun --cpu-bind=cores ./build_hillshade.sh
