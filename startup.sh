#!/bin/bash
set -e
pip install -r /home/site/wwwroot/backend/requirements.txt
python3 /home/site/wwwroot/backend/main.py
