import re

with open('frontend/components/VideoPlayer.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace(
    '''  function retryPlay() {
    const v = videoRef.current;
    if (!v) return;
    setHasError(false);
    setIsBuffering(false);
    setSrcLoaded(false);
    v.src = "";
    v.load();
  }''',
    '''  function retryPlay() {
    const v = videoRef.current;
    if (!v) return;
    setHasError(false);
    setIsBuffering(false);
    setSrcLoaded(true);
    v.src = streamUrl + "&t=" + Date.now();
    v.load();
    v.play().catch(() => {});
  }'''
)

with open('frontend/components/VideoPlayer.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
