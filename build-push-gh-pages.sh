#!/bin/bash
set -e

REPO="git@github.com:rsimmons/rindel.git"

# courtesy of http://unix.stackexchange.com/questions/30091/fix-or-alternative-for-mktemp-in-os-x
BUILDTMP=`mktemp -d 2>/dev/null || mktemp -d -t 'mytmpdir'`

echo "Building in $BUILDTMP ..."

echo "Cloning from github ..."
git clone --depth 1 $REPO $BUILDTMP/src

SRC_SHA="$(cd $BUILDTMP/src && git rev-parse HEAD)"

echo "Doing build ..."
(
cd $BUILDTMP/src
cd compiler
npm install
cd ../runtime
npm install
cd ../demo
npm install
npm run build-prod
)

echo "Cloning gh-pages from github ..."
git clone --depth 1 --branch gh-pages $REPO $BUILDTMP/dst

echo "Copying from build dir to gh-pages clone ..."
rsync -a --delete --exclude '.git' $BUILDTMP/src/demo/public/ $BUILDTMP/dst

echo "Commiting and pushing to origin gh-pages ..."
(
cd $BUILDTMP/dst
git add --all
git commit -m "build of $SRC_SHA"
git push origin gh-pages:gh-pages
)

echo "Cleaning up temp dir ..."
rm -rf $BUILDTMP

echo "Done."
