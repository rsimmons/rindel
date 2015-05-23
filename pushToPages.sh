#!/bin/bash
set -e

git subtree split --prefix demo/public -b gh-pages
git push -f origin gh-pages:gh-pages
git branch -D gh-pages
