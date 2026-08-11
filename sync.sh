cd /Users/awosnjuk/Documents/Personal/UBF/website/UBF
aws s3 sync . s3://vivabrazil-bucket/ \
  --exclude ".git/*" \
  --exclude ".DS_Store" \
  --exclude "worker/*"


aws cloudfront create-invalidation --distribution-id E1BLRLJ1NISI0O --paths "/*"
