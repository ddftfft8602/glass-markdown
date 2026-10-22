// Copy decoded pixels, rather than the URL in the image settings field.
window.glassCopyImage = async image => {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前环境不支持图片剪贴板');
    const png = (async () => {
      // VS Code serves local resources from a different origin. Decode a
      // fetched blob so drawing the visible <img> cannot taint the canvas.
      let url = image.currentSrc || image.src, owned = false;
      if (!/^(data:|blob:)/i.test(url)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('图片读取失败');
        url = URL.createObjectURL(await response.blob()); owned = true;
      }
      try {
        const decoded = new Image(); decoded.src = url; await decoded.decode();
        const canvas = document.createElement('canvas');
        canvas.width = decoded.naturalWidth; canvas.height = decoded.naturalHeight;
        if (!canvas.width || !canvas.height) throw new Error('图片尚未加载');
        canvas.getContext('2d').drawImage(decoded, 0, 0);
        return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片转换失败')), 'image/png'));
      } finally { if (owned) URL.revokeObjectURL(url); }
    })();
    // Start the write during the user's click, before asynchronous decoding.
    await navigator.clipboard.write([new ClipboardItem({'image/png': png})]);
    return true;
  } catch (error) {
    window.glassEditor?.tip(`无法复制图片：${error.message}`, 5000);
    return false;
  }
};
