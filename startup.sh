#!/bin/bash
set -e
python3 -m ensurepip --upgrade
python3 -m pip install -r /home/site/wwwroot/backend/requirements.txt
python3 /home/site/wwwroot/backend/main.py
