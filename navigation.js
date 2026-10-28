(() => {
  'use strict';
  const articles = document.querySelector('.post-index details');
  if (!articles) return;
  const mobile = window.matchMedia('(max-width: 58rem)');
  const index = articles.closest('.post-index');
  const navigation = document.querySelector('.site-header nav');
  const originalPosition = document.createComment('Article sidebar');
  index.before(originalPosition);
  const update = () => {
    articles.open = !mobile.matches;
    if (mobile.matches) navigation.append(index);
    else originalPosition.after(index);
  };
  update();
  mobile.addEventListener('change', update);
})();
