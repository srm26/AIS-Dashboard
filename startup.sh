#!/bin/bash
set -e
pip3 install -r /home/site/wwwroot/backend/requirements.txt
python3 /home/site/wwwroot/backend/main.py
