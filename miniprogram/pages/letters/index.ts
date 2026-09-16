Page({
  onWrite() {
    void wx.navigateTo({ url: '/pages/write-letter/index' });
  },
  onMine() {
    void wx.navigateTo({ url: '/pages/my-letters/index' });
  },
});
