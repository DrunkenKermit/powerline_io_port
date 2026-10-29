	(function() {
		var trigger = document.getElementById('moreInfoTrigger');
		var overlay = document.getElementById('moreInfoOverlay');
		var dismiss = document.getElementById('moreInfoDismiss');
		var previousFocus = null;
		if(!trigger || !overlay || !dismiss)
			return;

		function setMoreInfoOpen(isOpen) {
			trigger.setAttribute('aria-expanded', String(isOpen));
			if(isOpen)
			{
				previousFocus = document.activeElement;
				overlay.hidden = false;
				dismiss.focus();
				return;
			}

			overlay.hidden = true;
			if(previousFocus && typeof previousFocus.focus == 'function')
				previousFocus.focus();
			previousFocus = null;
		}

		trigger.addEventListener('click', function(event) {
			event.preventDefault();
			setMoreInfoOpen(true);
		});
		dismiss.addEventListener('click', function() {
			setMoreInfoOpen(false);
		});
		overlay.addEventListener('click', function(event) {
			if(event.target === overlay)
				setMoreInfoOpen(false);
		});
		document.addEventListener('keydown', function(event) {
			if(event.key == 'Escape' && !overlay.hidden)
			{
				event.preventDefault();
				setMoreInfoOpen(false);
			}
		});
	})();

