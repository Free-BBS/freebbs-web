((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, { freeBbsAvatar: api });
  }
})(typeof window === 'object' ? window : globalThis, () => {
  const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
  const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

  function validateAvatarFile(file) {
    if (!file || !ALLOWED_TYPES.has(file.type)) {
      return '请选择 PNG、JPG、WEBP 或 GIF 图片。';
    }
    if (!file.size) return '图片文件为空，请重新选择。';
    if (file.size > MAX_AVATAR_BYTES) return '图片不能超过 5 MiB，请选择较小的图片。';
    return '';
  }

  function readAvatarImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败，请重新选择。'));
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const image = new Image();
        image.onerror = () => reject(new Error('无法识别这张图片，请选择有效的图片文件。'));
        image.onload = () => {
          if (!image.naturalWidth || !image.naturalHeight) {
            reject(new Error('图片没有有效尺寸，请重新选择。'));
            return;
          }
          resolve(dataUrl);
        };
        image.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function createController({ root, upload, onSaved, readImage = readAvatarImage }) {
    const input = root.querySelector('#settings-avatar-input');
    const choose = root.querySelector('[data-avatar-action="choose"]');
    const confirm = root.querySelector('[data-avatar-action="confirm"]');
    const cancel = root.querySelector('[data-avatar-action="cancel"]');
    const preview = root.querySelector('[data-avatar-preview]');
    const previewImage = root.querySelector('#settings-avatar-pending-image');
    const fileLabel = root.querySelector('[data-avatar-file]');
    const message = root.querySelector('[data-avatar-message]');
    let pending = null;
    let busy = false;
    let retry = false;

    function setMessage(text, state = 'info') {
      message.textContent = text;
      message.dataset.state = state;
    }

    function render() {
      root.setAttribute('aria-busy', String(busy));
      input.disabled = busy;
      choose.disabled = busy;
      confirm.disabled = busy || !pending;
      cancel.disabled = busy;
      preview.hidden = !pending;
      confirm.hidden = !pending;
      cancel.hidden = !pending;
      confirm.textContent = retry ? '重试上传' : '确认上传';
      if (busy) confirm.textContent = '处理中…';
      choose.textContent = pending ? '重新选择图片' : '选择新头像';
    }

    function clearPending() {
      pending = null;
      retry = false;
      input.value = '';
      previewImage.removeAttribute('src');
      fileLabel.textContent = '';
    }

    async function selectFile(file) {
      if (busy || !file) return;
      const validation = validateAvatarFile(file);
      input.value = '';
      if (validation) {
        setMessage(validation, 'error');
        return;
      }
      busy = true;
      render();
      setMessage('正在读取图片，请稍候…');
      try {
        const dataUrl = await readImage(file);
        pending = { dataUrl };
        retry = false;
        previewImage.src = dataUrl;
        fileLabel.textContent = `${file.name || '已选图片'} · ${(file.size / 1024).toFixed(1)} KiB`;
        setMessage('这是待上传预览。点击“确认上传”后才会替换当前头像。');
      } catch (error) {
        setMessage(error.message || '读取图片失败，请重新选择。', 'error');
      } finally {
        busy = false;
        render();
      }
    }

    async function submit() {
      if (busy || !pending) return;
      busy = true;
      render();
      setMessage('正在上传头像，请勿重复提交…');
      try {
        const payload = await upload(pending.dataUrl);
        // The server has committed the avatar. A display error must not invite another upload.
        clearPending();
        try {
          onSaved(payload);
          setMessage('头像已更新。图片已转为最长边 512 像素的 WEBP，GIF 使用静态首帧。', 'success');
        } catch {
          setMessage('头像已上传，但页面显示未能更新，请刷新页面查看。', 'success');
        }
      } catch (error) {
        retry = true;
        setMessage(error.message || '上传失败，原头像未更改，请重试。', 'error');
      } finally {
        busy = false;
        render();
        if (!pending) choose.focus();
      }
    }

    function cancelSelection() {
      if (busy) return;
      clearPending();
      setMessage('已取消，本次没有上传图片。');
      render();
      choose.focus();
    }

    choose.addEventListener('click', () => input.click());
    input.addEventListener('change', () => selectFile(input.files?.[0]));
    confirm.addEventListener('click', submit);
    cancel.addEventListener('click', cancelSelection);
    render();

    return Object.freeze({ selectFile, submit, cancel: cancelSelection });
  }

  return Object.freeze({ createController, validateAvatarFile, MAX_AVATAR_BYTES });
});
