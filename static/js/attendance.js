try {
    signed;
} catch (e) {
	$('#visitAlert').removeClass('hidden');
}

var app = angular.module('Attendance', []);

app.controller('AttendanceController', function ($scope, $http) {
    $scope.visitors = [];

    $http({
        method: 'GET',
        url: '/api/attendance'
    }).then(function (response) {
        $scope.visitors = response.data;
    }, function () {});
});
