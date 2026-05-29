#!/bin/bash
#SBATCH --job-name=recompute_means
#SBATCH --partition=himem
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G
#SBATCH --time=02:00:00
#SBATCH --output=/mnt/shared/scratch/adutta/climascope/app/logs/recompute_%j.log
#SBATCH --error=/mnt/shared/scratch/adutta/climascope/app/logs/recompute_%j.err

echo "Started: $(date)"
echo "Node: $SLURMD_NODENAME"

FACTS_DIR=/mnt/shared/scratch/adutta/climascope/facts_catalog \
GRID_FILE=/mnt/shared/scratch/adutta/climascope/app/data/grid.parquet \
PRECOMP_DIR=/mnt/shared/scratch/adutta/climascope/app/data/precomputed \
COG_DIR=/mnt/shared/scratch/adutta/climascope/app/data/cogs \
  /mnt/apps/users/adutta/conda/bin/python \
  /mnt/shared/scratch/adutta/climascope/precompute_means.py

echo "Finished: $(date)"
