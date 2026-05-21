const api = async (url, options = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
};

let currentUser = null;

const initApp = async () => {
  try {
    currentUser = await api('/api/user');
    updateAuthUI();
  } catch (e) {
    currentUser = null;
  }
  initPage();
};

const updateAuthUI = () => {
  const authBtns = document.getElementById('authBtns');
  const userMenu = document.getElementById('userMenu');
  if (!authBtns || !userMenu) return;
  
  if (currentUser) {
    authBtns.classList.add('hidden');
    userMenu.classList.remove('hidden');
    userMenu.querySelector('.username').textContent = currentUser.username;
    if (currentUser.role === 'admin') {
      const adminLink = document.createElement('a');
      adminLink.href = '/admin/index.html';
      adminLink.className = 'nav-link';
      adminLink.textContent = '管理后台';
      userMenu.insertBefore(adminLink, userMenu.firstChild);
    }
  } else {
    authBtns.classList.remove('hidden');
    userMenu.classList.add('hidden');
  }
};

const logout = async () => {
  await api('/api/logout', { method: 'POST' });
  currentUser = null;
  location.href = '/';
};

const Toast = {
  show(msg, type = 'info') {
    const container = document.getElementById('toastContainer') || (() => {
      const div = document.createElement('div');
      div.id = 'toastContainer';
      div.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999';
      document.body.appendChild(div);
      return div;
    })();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    toast.style.cssText = `
      padding:12px 20px;margin-bottom:10px;border-radius:8px;
      background:${type === 'success' ? '#34a853' : type === 'error' ? '#ea4335' : '#1a73e8'};
      color:#fff;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.15);
      animation:slideIn .3s ease;min-width:200px;
    `;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
  },
  success: msg => Toast.show(msg, 'success'),
  error: msg => Toast.show(msg, 'error'),
  info: msg => Toast.show(msg, 'info')
};

const formatDate = date => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const escapeHtml = str => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

const renderPagination = (container, { page, limit, total }, onChange) => {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return container.innerHTML = '';
  
  let html = '<div class="pagination">';
  if (page > 1) html += `<button class="page-btn" data-page="${page - 1}">上一页</button>`;
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || (i >= page - 2 && i <= page + 2)) {
      html += `<button class="page-btn${i === page ? ' active' : ''}" data-page="${i}">${i}</button>`;
    } else if (i === page - 3 || i === page + 3) {
      html += '<span class="page-ellipsis">...</span>';
    }
  }
  if (page < pages) html += `<button class="page-btn" data-page="${page + 1}">下一页</button>`;
  html += '</div>';
  
  container.innerHTML = html;
  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.onclick = () => onChange(Number(btn.dataset.page));
  });
};

const previewImages = (input, container) => {
  container.innerHTML = '';
  const files = Array.from(input.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const div = document.createElement('div');
      div.className = 'preview-item';
      div.innerHTML = `<img src="${e.target.result}" alt="预览"><span class="remove">&times;</span>`;
      div.querySelector('.remove').onclick = () => {
        div.remove();
        const dt = new DataTransfer();
        Array.from(input.files).filter(f => f !== file).forEach(f => dt.items.add(f));
        input.files = dt.files;
      };
      container.appendChild(div);
    };
    reader.readAsDataURL(file);
  });
};

const initPage = () => {};

document.addEventListener('DOMContentLoaded', initApp);
