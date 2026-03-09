// Photo handling with compression
const PhotoHandler = {
  async selectPhoto(source) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      
      if (source === 'camera') {
        input.capture = 'environment';
      }
      
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) {
          reject(new Error('No file selected'));
          return;
        }
        
        try {
          const compressed = await this.compressImage(file);
          resolve(compressed);
        } catch (err) {
          reject(err);
        }
      };
      
      input.onerror = () => reject(new Error('File selection failed'));
      input.click();
    });
  },

  async compressImage(file, maxWidth = 800, maxHeight = 600, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const img = new Image();
        
        img.onload = () => {
          // Calculate new dimensions
          let width = img.width;
          let height = img.height;
          
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
          
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
          
          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to blob
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve({
                  blob,
                  url: canvas.toDataURL('image/jpeg', quality),
                  width,
                  height
                });
              } else {
                reject(new Error('Compression failed'));
              }
            },
            'image/jpeg',
            quality
          );
        };
        
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = e.target.result;
      };
      
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  },

  async uploadPhoto(blob, filename = null) {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Not authenticated');
    
    const formData = new FormData();
    formData.append('photo', blob, filename || `photo-${Date.now()}.jpg`);
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }
    
    const data = await response.json();
    return data.photo_url;
  },

  async selectAndUpload(source) {
    const compressed = await this.selectPhoto(source);
    return await this.uploadPhoto(compressed.blob);
  }
};

// Global function for use in HTML
async function selectPhoto(source) {
  try {
    const result = await PhotoHandler.selectPhoto(source);
    const preview = $('#photo-preview');
    const dataInput = $('#photo-data');
    
    if (preview && dataInput) {
      preview.src = result.url;
      preview.style.display = 'block';
      dataInput.value = result.url;
    }
    
    return result;
  } catch (err) {
    console.error('Photo selection error:', err);
    alert('Ошибка выбора фото: ' + err.message);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PhotoHandler;
}
