#!/bin/bash
set -e
pip install -r /home/site/wwwroot/backend/requirements.txt
export PYTHONPATH=/home/site/wwwroot/backend
python /home/site/wwwroot/backend/main.py
